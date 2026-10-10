-- QuickCart add-on migration: saved delivery addresses + order placement.
-- Separate quickcart_* names avoid assuming the layout of the existing addresses table.
create extension if not exists pgcrypto;

create table if not exists public.quickcart_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  formatted_address text not null,
  place_id text,
  latitude double precision not null,
  longitude double precision not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists quickcart_addresses_user_idx on public.quickcart_addresses(user_id, is_default desc, created_at desc);
alter table public.quickcart_addresses enable row level security;

drop policy if exists "Users read own QuickCart addresses" on public.quickcart_addresses;
create policy "Users read own QuickCart addresses" on public.quickcart_addresses for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own QuickCart addresses" on public.quickcart_addresses;
create policy "Users insert own QuickCart addresses" on public.quickcart_addresses for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own QuickCart addresses" on public.quickcart_addresses;
create policy "Users update own QuickCart addresses" on public.quickcart_addresses for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own QuickCart addresses" on public.quickcart_addresses;
create policy "Users delete own QuickCart addresses" on public.quickcart_addresses for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.quickcart_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  address_id uuid not null references public.quickcart_addresses(id) on delete restrict,
  delivery_address text not null,
  latitude double precision not null,
  longitude double precision not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  delivery_fee numeric(12,2) not null default 30 check (delivery_fee >= 0),
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'placed' check (status in ('placed','confirmed','packing','out_for_delivery','delivered','cancelled')),
  payment_method text not null default 'cash_on_delivery' check (payment_method in ('cash_on_delivery')),
  created_at timestamptz not null default now()
);
create index if not exists quickcart_orders_user_idx on public.quickcart_orders(user_id, created_at desc);

create table if not exists public.quickcart_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.quickcart_orders(id) on delete cascade,
  product_id integer not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);
create index if not exists quickcart_order_items_order_idx on public.quickcart_order_items(order_id);

alter table public.quickcart_orders enable row level security;
alter table public.quickcart_order_items enable row level security;
drop policy if exists "Users read own QuickCart orders" on public.quickcart_orders;
create policy "Users read own QuickCart orders" on public.quickcart_orders for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users read own QuickCart order items" on public.quickcart_order_items;
create policy "Users read own QuickCart order items" on public.quickcart_order_items for select to authenticated using (
  exists (select 1 from public.quickcart_orders o where o.id = order_id and o.user_id = auth.uid())
);

create or replace function public.place_quickcart_order(p_address_id uuid, p_items jsonb, p_delivery_fee numeric default 30)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_address public.quickcart_addresses%rowtype;
  v_order_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal numeric(12,2) := 0;
  v_fee numeric(12,2);
begin
  if v_user_id is null then raise exception 'Please sign in before placing an order.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;

  select * into v_address from public.quickcart_addresses where id = p_address_id and user_id = v_user_id;
  if not found then raise exception 'Select a valid delivery address.'; end if;
  v_fee := greatest(coalesce(p_delivery_fee, 30), 0);

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'product_id','') !~ '^[0-9]+$' or coalesce(v_item->>'quantity','') !~ '^[0-9]+$' then
      raise exception 'Invalid product or quantity in cart.';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'Invalid product quantity.'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::integer for update;
    if not found then raise exception 'A product in your cart no longer exists.'; end if;
    if v_product.stock < v_quantity then raise exception 'Not enough stock for %.', v_product.name; end if;
    v_subtotal := v_subtotal + (v_product.price * v_quantity);
  end loop;

  insert into public.quickcart_orders (user_id,address_id,delivery_address,latitude,longitude,subtotal,delivery_fee,total,status,payment_method)
  values (v_user_id,v_address.id,v_address.formatted_address,v_address.latitude,v_address.longitude,v_subtotal,v_fee,v_subtotal+v_fee,'placed','cash_on_delivery')
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id = (v_item->>'product_id')::integer for update;
    insert into public.quickcart_order_items (order_id,product_id,product_name,unit_price,quantity,line_total)
    values (v_order_id,v_product.id,v_product.name,v_product.price,v_quantity,v_product.price*v_quantity);
    update public.products set stock = stock - v_quantity where id = v_product.id;
  end loop;
  return v_order_id;
end;
$$;

revoke all on function public.place_quickcart_order(uuid,jsonb,numeric) from public;
grant execute on function public.place_quickcart_order(uuid,jsonb,numeric) to authenticated;
