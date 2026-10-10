# QuickCart Rider — standalone Vite + React + Supabase app

This is a separate rider dashboard for the existing QuickCart hackathon project. It connects to the **same Supabase project** as the customer app and your friend's admin panel, but it lives in its own folder/deployment so changes to the rider UI don't affect either app.

## What's included

- Rider magic-link sign-in using the existing Supabase Auth project.
- Admin-approved rider accounts (customers cannot self-activate as riders).
- Available orders appear automatically after a customer places an order.
- Atomic **Accept delivery** action, so two riders cannot claim the same order.
- Delivery progression: `awaiting_rider` → `accepted` → `picked_up` → `delivered`.
- Order line items, delivery address, total, and payment method/status.
- Supabase Realtime listener plus a 10-second polling fallback.
- Mobile-friendly layout and Netlify config.

## Important compatibility note for this QuickCart version

The current customer checkout bypasses real payment: it inserts orders with `status = 'confirmed'` and `payment_status = 'pending'`, for the selected `cod`, `card`, or `upi` method. This rider app intentionally puts these confirmed demo orders into the queue **even while payment is pending**, so your hackathon demo flow works. It does not mark card/UPI payments as paid and it does not alter the existing `orders.status` field. Rider progress is stored separately in `orders.delivery_status`, which your friend can also read in the admin panel.

## 1. Configure the app

1. Open this `QuickCart_Rider_App` folder in VS Code (keep it separate from the customer app).
2. Copy `.env.example` to a file named `.env`.
3. Fill in the same Supabase Project URL and **anon/publishable key** that your customer app uses:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
   ```

   Do **not** put a `service_role` key in a browser app or commit `.env` to Git.
4. In this folder's terminal run:

   ```bash
   npm install
   npm run dev
   ```

   Use the localhost URL that Vite prints. If the customer app already uses port 5173, Vite will usually choose 5174 for this app.

## 2. Run the Supabase SQL setup

1. Open your shared Supabase project → **SQL Editor**.
2. Open `supabase/rider_setup.sql` from this folder and run the entire script.
3. It creates `public.riders`, adds rider assignment/delivery timestamps to `public.orders`, initializes `delivery_status` for newly inserted/confirmed orders, adds rider-safe read policies, and creates the RPC functions used for claiming/updating deliveries.
4. The script deliberately preserves the existing customer/admin `orders.status` and `payment_status` fields. Existing historical orders are not automatically added to the rider queue; test with a **new order after running the SQL**.

The setup expects the existing `public.orders` and `public.order_items` tables from the customer app, including `orders.updated_at`, `orders.delivery_address`, `orders.created_at`, and the `order_items` columns `order_id`, `product_name`, `quantity`, `unit_price`, `line_total`. Those are the fields used by the provided customer app. If your friend changed any of these names/types in the shared schema, stop and reconcile the SQL with the actual schema before running it.

## 3. Allow the magic-link redirect

In Supabase → **Authentication → URL Configuration**, add the exact localhost URL shown by Vite to **Redirect URLs**. For example:

```text
http://localhost:5174/**
```

Also add your deployed rider-app URL here once you deploy it. The Site URL can stay set to your existing customer site while using explicit redirect URLs for the rider site.

Email sign-in uses the same Supabase Auth email configuration as the other QuickCart apps. Your recent Auth log showed that Resend was rejecting `yourdomain.com` because it was unverified; that email-provider problem must be fixed for magic links to arrive. The rider app does not bypass Auth or the provider's sending rules.

## 4. Activate a rider account

Rider access is not self-approved. This helps stop any authenticated customer from accepting deliveries.

1. Open the rider app and sign in with the email for the intended rider. Supabase Auth will create the Auth user if necessary.
2. If the app says the rider is not active, copy the displayed **Supabase User ID**.
3. In Supabase → SQL Editor, run this statement with that UUID and the correct name/phone:

   ```sql
   insert into public.riders (user_id, full_name, phone, vehicle_type, is_active)
   values ('PASTE-RIDER-USER-UUID-HERE', 'Rider Name', '9876543210', 'Bike', true)
   on conflict (user_id) do update set
     full_name = excluded.full_name,
     phone = excluded.phone,
     vehicle_type = excluded.vehicle_type,
     is_active = true;
   ```

4. Return to the rider app and click **Check access again**.

The dashboard also has a **Copy activation SQL** helper that pre-fills the signed-in user's UUID.

## 5. Test the complete flow

1. Run the customer app and the rider app against this same Supabase project.
2. Create a **new customer order** and select COD, Card, or UPI. The current checkout bypasses actual payment and saves a confirmed order with `payment_status = 'pending'`.
3. Within a few seconds, the order should appear in **Available** in the rider app.
4. Click **Accept delivery**. Only one rider can claim it.
5. Click **Mark picked up**, then **Mark delivered**.
6. In Supabase `public.orders`, check `rider_id`, `delivery_status`, `accepted_at`, `picked_up_at`, and `delivered_at`.

## 6. Share schema expectations with the admin-panel teammate

Tell your friend that delivery progression now lives on the existing `orders` row in these fields:

- `rider_id` — the assigned rider's Supabase Auth user UUID
- `delivery_status` — `awaiting_rider`, `accepted`, `picked_up`, or `delivered`
- `accepted_at`, `picked_up_at`, `delivered_at` — timestamps

Don't overwrite these delivery fields when editing `orders.status`. If the admin panel needs to manage riders, create/activate rows in `public.riders` through an appropriately protected admin action or through the SQL Editor for the hackathon demo.

## 7. Deploy separately to Netlify

1. Build from this folder with `npm run build`.
2. Deploy this app's `dist` folder or connect this folder to its own Netlify site.
3. Add the rider site's public URL under Supabase Auth **Redirect URLs**.
4. Add this rider URL in your Netlify environment variables using the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values, then redeploy.

## Troubleshooting

- **No orders appear:** run the SQL first, then create a new order. The order should have `status='confirmed'` and `delivery_status='awaiting_rider'`. This app includes pending-payment demo orders intentionally.
- **RLS permission error:** verify the full SQL setup completed and the rider is active.
- **Order items don't load:** confirm there is an `order_items.order_id` foreign key to `orders.id` and the item columns listed above exist.
- **Email link fails:** fix the project's Supabase Auth SMTP configuration first; this is shared with the other QuickCart apps.
- **Order table says missing `updated_at` or types differ:** pause before running/altering more SQL and compare the shared schema with the preconditions above.

This is a hackathon MVP. It does not include route optimization, live GPS tracking, proof-of-delivery photos, payment collection, or production dispatch guarantees.
