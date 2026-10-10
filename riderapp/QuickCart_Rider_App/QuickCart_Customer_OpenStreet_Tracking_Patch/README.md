# QuickCart Customer Tracking Patch

Adds a customer-side order tracking page to the provided customer app. The confirmation page has a **Track my delivery** button and the tracking page supports a URL like `?track-order=YOUR_ORDER_ID`.

## Install
1. Back up the customer's current `src/App.tsx` and `src/index.css`.
2. Copy these files over the matching files in your existing customer Vite project.
3. Keep your existing `.env`, `src/lib/supabase.ts`, and `package.json` unchanged. The supplied app already uses Leaflet/React Leaflet for the checkout map.
4. Run `npm run dev` or build with `npm run build`.

## What it does
- Reads only an order whose `user_id` matches the authenticated customer.
- Shows the delivery progress and a live OpenStreetMap panel.
- Hides rider coordinates while the order is only `accepted`; displays current/last location and an OSRM road route once `delivery_status` is `picked_up`.
- Uses Supabase Realtime plus a 10-second refresh fallback.
- Needs destination latitude/longitude in the customer's saved `addresses` row.

Before using, run `supabase/rider_setup.sql` from the Rider App folder in the shared Supabase project. That adds the GPS fields/RPC and policies used by both apps.

Map layers are credited to OpenStreetMap contributors; routing uses OSRM. The public services are for moderate hackathon testing, not guaranteed production infrastructure.
