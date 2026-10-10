-- QuickCart Rider MVP setup
-- Run once in Supabase Dashboard -> SQL Editor after the customer orders/order_items tables exist.
-- This adds rider-specific delivery metadata without changing orders.status or payment_status.

begin;

create table if not exists public.riders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  vehicle_type text default 'Bike',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.riders enable row level security;
drop policy if exists "Riders can view their own profile" on public.riders;
create policy "Riders can view their own profile"
  on public.riders for select to authenticated
  using (user_id = auth.uid());

-- Add separate rider delivery fields so the existing customer/admin status field
-- and payment bypass behaviour are preserved.
alter table public.orders add column if not exists rider_id uuid;
alter table public.orders add column if not exists delivery_status text;
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists picked_up_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_rider_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_rider_id_fkey
      FOREIGN KEY (rider_id) REFERENCES public.riders(user_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_status_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_status_check
      CHECK (delivery_status IS NULL OR delivery_status IN ('awaiting_rider', 'accepted', 'picked_up', 'delivered'));
  END IF;
END $$;

create index if not exists orders_delivery_queue_idx
  on public.orders (delivery_status, created_at desc);
create index if not exists orders_rider_active_idx
  on public.orders (rider_id, delivery_status, created_at desc);

-- Only orders created/confirmed after this setup are automatically added to the queue.
-- Existing historical orders remain delivery_status=NULL until deliberately updated.
create or replace function public.quickcart_set_delivery_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text = 'confirmed' and new.delivery_status is null then
    new.delivery_status := 'awaiting_rider';
  end if;
  return new;
end;
$$;

drop trigger if exists quickcart_orders_delivery_queue on public.orders;
create trigger quickcart_orders_delivery_queue
  before insert or update of status on public.orders
  for each row execute function public.quickcart_set_delivery_status();

-- Riders can read only unclaimed orders and orders assigned to themselves.
-- Existing customer/admin policies are left in place; PostgreSQL combines permissive
-- policies with OR, so customer access remains governed by existing policies.
alter table public.orders enable row level security;
drop policy if exists "Active riders can view available and assigned orders" on public.orders;
create policy "Active riders can view available and assigned orders"
  on public.orders for select to authenticated
  using (
    exists (
      select 1 from public.riders r
      where r.user_id = auth.uid() and r.is_active = true
    )
    and (
      (rider_id = auth.uid())
      or (rider_id is null and delivery_status = 'awaiting_rider')
    )
  );

-- Let an eligible rider see the line items attached to available/assigned orders.
alter table public.order_items enable row level security;
drop policy if exists "Active riders can view items for available and assigned orders" on public.order_items;
create policy "Active riders can view items for available and assigned orders"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.riders r on r.user_id = auth.uid() and r.is_active = true
      where o.id = order_items.order_id
        and (
          o.rider_id = auth.uid()
          or (o.rider_id is null and o.delivery_status = 'awaiting_rider')
        )
    )
  );

-- Atomic claim: when multiple riders tap Accept, only one update can win.
create or replace function public.rider_claim_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider_id uuid := auth.uid();
  v_claimed_id text;
  v_delivery_status text;
begin
  if v_rider_id is null then
    raise exception 'Sign in before accepting a delivery';
  end if;
  if not exists (
    select 1 from public.riders r
    where r.user_id = v_rider_id and r.is_active = true
  ) then
    raise exception 'Your QuickCart rider account is not active';
  end if;

  update public.orders o
  set rider_id = v_rider_id,
      delivery_status = 'accepted',
      accepted_at = now(),
      updated_at = now()
  where o.id::text = p_order_id
    and o.rider_id is null
    and o.delivery_status = 'awaiting_rider'
  returning o.id::text, o.delivery_status into v_claimed_id, v_delivery_status;

  if v_claimed_id is null then
    raise exception 'This order is no longer available. Another rider may have accepted it.';
  end if;

  return jsonb_build_object('order_id', v_claimed_id, 'delivery_status', v_delivery_status);
end;
$$;

-- Only allow the current assigned rider to move their job forward in order.
create or replace function public.rider_update_delivery_status(p_order_id text, p_next_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider_id uuid := auth.uid();
  v_updated_id text;
  v_delivery_status text;
begin
  if v_rider_id is null then
    raise exception 'Sign in before updating a delivery';
  end if;
  if not exists (
    select 1 from public.riders r
    where r.user_id = v_rider_id and r.is_active = true
  ) then
    raise exception 'Your QuickCart rider account is not active';
  end if;

  if p_next_status = 'picked_up' then
    update public.orders o
    set delivery_status = 'picked_up', picked_up_at = now(), updated_at = now()
    where o.id::text = p_order_id
      and o.rider_id = v_rider_id
      and o.delivery_status = 'accepted'
    returning o.id::text, o.delivery_status into v_updated_id, v_delivery_status;
  elsif p_next_status = 'delivered' then
    update public.orders o
    set delivery_status = 'delivered', delivered_at = now(), updated_at = now()
    where o.id::text = p_order_id
      and o.rider_id = v_rider_id
      and o.delivery_status = 'picked_up'
    returning o.id::text, o.delivery_status into v_updated_id, v_delivery_status;
  else
    raise exception 'Unsupported delivery status transition';
  end if;

  if v_updated_id is null then
    raise exception 'Delivery status could not be updated. Refresh the dashboard and try again.';
  end if;

  return jsonb_build_object('order_id', v_updated_id, 'delivery_status', v_delivery_status);
end;
$$;

revoke all on function public.rider_claim_order(text) from public;
revoke all on function public.rider_update_delivery_status(text, text) from public;
grant execute on function public.rider_claim_order(text) to authenticated;
grant execute on function public.rider_update_delivery_status(text, text) to authenticated;

-- Realtime is optional; the app also polls every 10 seconds if this publication exists
-- but realtime isn't enabled for this table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'orders'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.orders';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'order_items'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items';
  END IF;
END $$;

commit;
