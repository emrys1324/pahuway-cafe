# Pahuway Cafe — online ordering & delivery

A lean, mobile-first ordering app for **Pahuway Cafe** (San Agustin, Romblon). Customers order for **pickup, dine-in pre-order or delivery** without an account. Staff run everything from a phone or tablet, and riders get a simple list of their deliveries.

| Customer (phone) | Staff (tablet) | Rider (phone) |
|---|---|---|
| ![Menu](docs/screenshots/1-menu.png) | ![Board](docs/screenshots/6-staff-board.png) | ![Rider](docs/screenshots/8-rider.png) |

More screenshots are in [`docs/screenshots/`](docs/screenshots).

**Online payments:** GCash and QR Ph via HitPay, alongside cash and manual GCash — see [docs/PAYMENTS.md](docs/PAYMENTS.md).

**Mobile app:** the same app ships as **Isla** for Android and iPhone (Capacitor), with push notifications. See [docs/MOBILE.md](docs/MOBILE.md) for the store release steps.

---

## What's inside

**Home** (`/`): customers can add the site to their phone's home screen as **Padaya** (Install button on Android/desktop, Share → Add to Home Screen steps on iPhone; offline page when there's no connection). Customers choose **Order from Pahuway Cafe** (shows whether the café is open and any items already in the cart) or **Rent a scooter from Baybayin** (`/baybayin`: scooter booking with an availability calendar, pickup/return hours (default 8 AM–10 PM; other times via Messenger), license photo, helmets, pickup only, agree-to-terms, then a deposit paid online via HitPay (optional switch) or by GCash receipt checked by staff, once *Accept bookings* is on and terms are written — otherwise *Coming soon*; see [docs/RENTALS.md](docs/RENTALS.md)). The home page, the café pages and Baybayin each have their **own header branding** (title, tagline, logo, colour), and the customer account ("Welcome back") page has its own header, icon and heading; the welcome text, card descriptions and the **website icon** (browser tab / home screen) are editable in Admin → Settings → Branding.

**Customers** go from menu (`/menu`) to order placed in 3 screens:
1. **Menu**: categories, photos, prices and "Sold out" badges. Tap an item to choose options (hot/iced, sugar level, milk, add-ons, pizza size) with live price updates. The cart opens as a drawer on the same screen.
2. **Checkout** (one page): pickup, delivery or dine-in; ASAP or a 15-minute time slot; name and mobile number. Delivery adds a barangay (the fee applies automatically), street/purok, landmark, notes to the rider and an optional **map pin** (tap the map or "Use my current location"). With a Google Maps key the address and map stay in sync: Google address suggestions move the pin, the barangay centres the map, and moving the pin fills in empty fields. See [docs/MAPS.md](docs/MAPS.md). Without a key it uses OpenStreetMap. Payment is cash, or GCash (QR code + reference number + screenshot upload).
3. **Confirmation & live status**: order number (e.g. `PH-0001`), a live progress timeline, and a shareable link.

There's also an optional **account** (`/account`) that saves the customer's address (and map pin) and shows their order history.

**Staff** (`/admin`):
- **Orders board**: live columns (New → Preparing → Ready → Out for delivery) and a loud chime for new orders that repeats every 30 s until they're accepted. Staff can accept, or reject with a reason, assign a rider and verify GCash payments (the screenshot is shown).
- **Menu**: items, categories and photos, with a one-tap **Sold out** switch.
- **Options**: choice groups and extra prices (e.g. turn off "Oat milk" when it runs out).
- **Zones**: barangays, fees and on/off switches.
- **Settings**: **branding** (logo, background photo with fade, store name, staff header title, and customer/staff header colours with automatically readable text — updates live everywhere), open/closed switch (also in the header), hours, delivery minimum, prep time, GCash QR, and the **Team** section (staff, admins and riders).
- **Summary**: orders, sales, average order, top 5 items, and sales by order type and payment method, for any day.
- **Team** (in Settings, full admins only): **invite** staff, admins and riders **by email** (or copy an invite link to send by Messenger/SMS) — they set their own password. Give each staff member exactly what they need with tick boxes: Orders board, Sold-out switches, Open/close the store, Menu & options, Delivery zones, Refunds, Sales summary, Store settings (Barista / Supervisor presets). Edit permissions anytime, send a password-reset link or email, **switch a login off** (locked out at once, history kept) or delete it. Admins can't lock themselves out; the last active admin can't be removed. See [docs/TEAM.md](docs/TEAM.md).
- **Sold out**: one page of switches for items and options (e.g. oat milk), for anyone with the Sold-out or Menu permission. Staff only see the pages their permissions allow.

**Riders** (`/rider`): only *their* assigned deliveries, with tap-to-call, address, landmark, a **map preview of the customer's pin with Google Maps and Waze buttons** (falls back to the typed address when there's no pin) and the **amount to collect**, plus big **Picked up** and **Delivered** buttons.

## Why this stack

**Next.js + Tailwind + Supabase**, hosted free or cheaply on **Vercel + Supabase**:

- **No server to look after.** Supabase provides the database, logins, photo storage and live updates in one place. A small café shouldn't be patching servers.
- **The rules live in the database.** Orders are placed through one database function, `place_order`, which recomputes every price, checks the 09XXXXXXXXX number format, the minimum order, opening hours and sold-out items. Access rules in the database (row-level security, or RLS) make sure riders only see their own orders and guests only see the order behind their link. A modified browser can't get around any of this.
- **Realtime is built in.** The staff board, the rider list, sold-out badges and the open/closed state all update instantly over Supabase Realtime.
- **Cost:** Supabase and Vercel free tiers are enough for a single café's volume. Expect ~US$25/mo for Supabase Pro if you want daily backups and no project pausing; the free tier pauses after 7 days without activity.

---

## Setup (local development)

**Requirements:** Node 20+, plus Docker if you want a local Supabase stack. You can skip Docker and use a free hosted Supabase project (see Deploy) for development too.

```bash
npm install
```

```bash
npm run db:start
```

`db:start` starts local Supabase, applies `supabase/migrations/0001_schema.sql` and loads `supabase/seed.sql`. It prints an API URL and keys. Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` from `db:start`, or Supabase → Settings → API | browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY`, or Settings → API → anon public | browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY`, or Settings → API → service_role | **server only**: "Add rider" button + seed script. Never expose it. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_RIDER_EMAIL` / `SEED_RIDER_PASSWORD` | your choice (optional) | `npm run seed:users` |
| `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME` | see [docs/RENTALS.md](docs/RENTALS.md) | **server only**: SMS for scooter bookings (optional) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | see [docs/MAPS.md](docs/MAPS.md) | browser: Google map + address suggestions (optional; OpenStreetMap without it) |
| `HITPAY_API_KEY`, `HITPAY_SALT`, `HITPAY_ENV`, `NEXT_PUBLIC_SITE_URL` | see [docs/PAYMENTS.md](docs/PAYMENTS.md) | **server only**: online payments (optional) |
| `PUSH_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` | see [docs/MOBILE.md](docs/MOBILE.md) | **server only**: push notifications for the Isla app (optional) |

Then create the starter logins and run the app:

```bash
npm run seed:users
```

```bash
npm run dev
```

Open http://localhost:3000. Staff and riders sign in at http://localhost:3000/login.

| Account | Email | Default password |
|---|---|---|
| Admin | `admin@pahuway.cafe` | `ChangeMe-Admin-2026` |
| Rider | `rider@pahuway.cafe` | `ChangeMe-Rider-2026` |

**Change these passwords before going live** (Supabase → Authentication → Users), or set the `SEED_*` variables before seeding.

### Seed data
- 20 menu items across Coffee, Non-Coffee, Pastries and Meals. Butter Croissant starts **sold out** so you can see the badge.
- 6 option groups: Temperature, Sugar level, Milk, Add-ons (max 3), Size (pizza solo/sharing), Meal add-ons.
- 5 delivery zones: Poblacion ₱30, Carmen ₱50, Dubduban ₱60, Long Beach ₱70, Cabolutan ₱80. **The fees are placeholders; set your real ones in Admin → Zones.**
- Store hours 9:00 AM – 11:30 PM (Asia/Manila), ₱200 delivery minimum, and a **SAMPLE** GCash QR. Upload the real one in Admin → Settings.
- Menu photos are bundled illustrations, so the app looks finished on day one. Replace them with real photos from Admin → Menu.

## Deploy (Vercel + Supabase)

1. **Create a Supabase project** at supabase.com and pick the **Southeast Asia (Singapore)** region, closest to Romblon.
2. **Create the database.** In the project's **SQL Editor**, run `supabase/migrations/0001_schema.sql`, then `supabase/seed.sql`. Or use the CLI: run `npx supabase link --project-ref <ref>`, then `npx supabase db push`, then run `seed.sql` in the SQL Editor.
3. **Auth settings** (Authentication → URL Configuration): set **Site URL** to your Vercel URL. Under Providers → Email, decide whether customer sign-ups need email confirmation (on by default; the app handles both).
4. **Create the logins.** Put the project's URL and service-role key in `.env.local`, then run `npm run seed:users` once from your computer.
5. **Deploy to Vercel.** Import the GitHub repo and add the three env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). The defaults handle the build.
6. **Check:** open the site on a phone and place a test order. Open `/admin` on the counter tablet and tap **"Tap to turn on order sound"** (browsers only allow sound after a tap, so do this once at the start of each shift). Turn the store **closed** and confirm customers see the closed message.

**Tips for the counter tablet:** keep it plugged in, turn off auto-lock (or use "Guided Access" on iPad), and add `/admin` to the home screen.

## Testing

| What | Command | Notes |
|---|---|---|
| Type check | `npm run typecheck` | |
| Production build | `npm run build` | |
| Database rules | `npm run test:db` | Needs `npm run db:start`. Checks prices, validation, sold-out, closed store, minimum order, RLS (guest / customer / rider / staff / admin), staff limits and deactivation, role escalation, rider actions, realtime broadcasts and the summary. Resets the local DB afterwards. |
| Database rules without Docker | see `supabase/tests/supabase_stubs.sql` | Runs the same scenarios on plain Postgres with stand-ins for Supabase's schemas. |
| Push sender (Firebase + APNs mocked, 12 checks) | `npm run test:push` | Needs local Supabase + `seed:users`. |
| App-mode behaviour (13 checks) | `npm run test:native` | Runs the site with Capacitor's real Android bridge and a fake native side: push registration, Notify me, no-Firebase safety. Needs the app on :3000. |
| Online payments: routes (24 checks) | `npm run test:payments` | Payment requests, webhook HMAC (form + JSON), API re-confirmation, amounts, idempotency, return-check vs. a mock HitPay. |
| Online payments: browser flow (14 checks) | `npm run test:payments:e2e` | Pay online → board shows order only when paid → refund → resume abandoned checkout → confirm without webhook. See docs/PAYMENTS.md for the env to start the app with. |
| Branding (21 checks) | `npm run test:branding` | Logo, background, store name, staff title and header colours: live updates, measured text contrast, staff screens stay plain, reset to defaults. |
| Delivery map pin (23 checks) | `npm run test:maps` | Pin by tap / current location / remove, saved on the order + account, guest pin remembered, server rejects pins outside the Philippines, rider Google Maps/Waze links + no-pin fallback, staff pin link. |
| Google Maps mode (26 checks) | `npm run test:google-maps` | Address suggestions → pin, barangay → map, pin → fills empty fields, never overwrites, rider/staff previews, fallback to OpenStreetMap if Google rejects the key. Uses a Google Maps stand-in; start the app with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=test-key`. |
| Team & permissions (27 checks) | `npm run test:team` | Needs the local email catcher (`npx supabase start`, mailpit on :54324). Invite by email (real email → /welcome → set password) and by link (rider), per-person permissions (pages, APIs, open/close), editing permissions, password-reset link + email, links work once, switch off/on, self-protection, delete keeps delivery history. |
| Scooter rentals (57 checks) | `npm run test:rentals` | Admin adds scooters, writes terms, opens bookings; availability calendar (all scooters / per scooter); pickup/return times (24-h blocks, grace, turnaround); license upload; terms gate before the GCash form; GCash reference + receipt upload; staff verify / reject / cancel + mark refunded; staff calendar; online deposit on mock HitPay (pay, auto-confirm, refund, resume); SMS (staff alert, confirmation after verify, cancel, refund, reminders) via a Semaphore stand-in; Coming soon when off or without terms. Start the app with the HitPay + Semaphore test env (see the test file). |
| Customer accounts | `npm run test:account` | Sign-up with the email optional: no email → account signs in with mobile number + password (ready immediately, one per number); sign-in accepts email or mobile; sign-up with an email unchanged; Forgot password (email link via the local mailbox; mobile accounts told to ask the café); admin temporary password for mobile accounts; change password in the account. |
| Sign-in required + Google (13 checks) | `npm run test:signin` | With *Customers must sign in* on: checkout and the booking details step show the sign-in step; Continue with Google goes to Google and returns to the page; cancelled Google sign-in shows a message; Create account / Sign in return to checkout with name + mobile filled in; the order is linked to the account; booking form pre-filled; My scooter bookings list; off-site return addresses ignored; switch off → guests order again. Other browser tests turn the setting off for their guest flows. |
| Landing page (17 checks) | `npm run test:landing` | Hero (title, buttons, menu photo or chosen photo, no faded background), guest sign-in shortcut, latest order shortcut, **Order again** (same items, quantities and options; sold-out items left out with a note), the two cards right under the header, Settings location + map link (https only). |
| Footer & Messages (20 checks) | `npm run test:nav` | Home · Activity · Messages footer on customer pages (not checkout / staff), never covers content, View cart bar sits above it; guests asked to sign in; inbox messages on order received / ready / completed with a live unread badge; opening Messages marks them read; tapping opens the order; Activity lists orders / scooter rentals. |
| Checkout & order chat (19 checks) | `npm run test:checkout` | Delivery / Pickup / Dine-in (Delivery first), Use my current location above the address, cash locked until 3 completed orders (and the number is editable in Settings), customer ↔ rider chat on delivery orders: opens when a rider is assigned, live both ways, copy in the customer's Messages, closes after delivery; no chat on pickup. |
| Hub (Phase 1) (19 checks) | `npm run test:hub` | Businesses set up; search box and category buttons (Cars/Stays/Tours *Soon*); What are you planning? tiles with From-prices; listing cards; search → Explore; filters; coming-soon pages; ♡ save as guest (asks to sign in) and signed in (Saved list, unsave); menu card opens the item; scooter card pre-selects the scooter. |
| Home-screen install (Padaya) | `npm run test:pwa` | Manifest (Padaya, standalone, 192/512 icons), iPhone home-screen tags, service worker + offline page, Install button (Android/desktop) and Share → Add to Home Screen tip (iPhone), Not now remembered. Needs a production build. |
| Rider sign-in | `npm run test:rider-login` | rider.<domain> (e.g. rider.padaya.online) serves only the rider pages; /rider → /rider/login (Padaya Rider branding, own home-screen app opening at /rider), staff turned away, rider lands on My deliveries, sign out → rider sign-in, staff page links to it, old /login still works for riders. |
| End-to-end acceptance test | `npm run test:e2e` | Needs local Supabase + `seed:users` + the app on :3000, plus Playwright (`npm i -D playwright && npx playwright install chromium`). Drives a customer phone, staff tablet and rider phone at once and re-creates the screenshots. |

The end-to-end test covers every acceptance criterion: a guest orders a customised iced latte for delivery and pays by GCash screenshot. Staff see it instantly with a chime, verify payment, accept, assign the rider and mark it ready, and the customer's page updates live at each step. The rider sees only their order and marks it picked up, then delivered. Marking Americano sold out removes its Add button on the customer's phone at once. Closing the store blocks ordering with a friendly message.

## Project structure

```
supabase/
  migrations/0001_schema.sql   tables, RLS, order functions, triggers, storage, realtime
  seed.sql                     sample menu, options, zones, settings
  tests/                       database scenario tests (+ stubs for plain Postgres)
src/
  app/                         routes: / (home) · /menu · /baybayin (+ /baybayin/booking/[token]) · /admin/rentals · /checkout · /order/[token] · /account · /login · /welcome · /admin/* · /rider · /api/admin/team
  components/customer/         menu, item sheet, cart, checkout, status page
  components/admin/            orders board, order detail, menu/options/zones/settings/summary
  lib/                         Supabase clients, cart, opening hours & time slots, formatting, sound
scripts/seed-users.mjs         creates the admin + rider logins
tests/e2e.js                   Playwright acceptance test
docs/                          SCHEMA.md, PHASE2.md, screenshots
```

## Operating notes & limits (MVP)

- **GCash is verified by hand.** Staff compare the reference number and amount in the café's GCash app, then tap *Mark GCash payment verified*. Screenshots are private (staff only).
- **Scheduling is same-day only,** in 15-minute slots from "now + prep time" up to 15 minutes before closing. Closing times after midnight are supported.
- **Language:** all customer text is in the components, ready to move into a translation file when Filipino labels are added (see Phase 2).
- **Phone validation** accepts `09XXXXXXXXX`, `+639…` or `639…` (spaces and dashes are fine) and stores everything as `09XXXXXXXXX`.
- **Cash orders** are marked paid automatically when completed or delivered.

Further reading: [Scooter rentals](docs/RENTALS.md) · [Team & permissions](docs/TEAM.md) · [Delivery map](docs/MAPS.md) · [Database schema](docs/SCHEMA.md) · [Phase 2 roadmap](docs/PHASE2.md)

## Rider address (rider.padaya.online)
Any host starting with `rider.` serves only the rider pages: `/` shows the rider sign-in or My deliveries, `/login` goes to the rider sign-in, other pages redirect to the main site (`NEXT_PUBLIC_SITE_URL`). To use it: Vercel → Project → Settings → Domains → add `rider.padaya.online`, then add the DNS record Vercel shows (usually `CNAME rider → cname.vercel-dns.com`) where the domain is registered.

## Customer accounts and Google sign-in
**Settings → Customer accounts → "Customers must sign in to order or book"** (on by default). Anyone can browse the menu and the Baybayin calendar and scooters. To place a café order or book a scooter, the customer signs in or creates a free account: Continue with Google, or a mobile number (email optional) and password. The database enforces it too (`place_order` / `book_scooter` refuse guests while it's on). Their details are filled in at checkout and on the booking form. Orders and scooter bookings show under **My account**. Turn the setting off to allow guest orders again.

**Turning on Google sign-in (one-time, owner):**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**. Choose External, use the app name *Padaya* and your support email, and **Publish** it.
2. Go to **Credentials** → Create credentials → **OAuth client ID** → *Web application*.
   - Authorized JavaScript origins: `https://pahuway-cafe.vercel.app` (add `https://padaya.online` too if you use it).
   - Authorized redirect URIs: `https://brisxzvkxkyfllffhhyg.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret** into Supabase → Authentication → Sign In / Providers → **Google** → Enable → Save. Never paste them into chat or code.
4. Supabase → Authentication → URL Configuration → Redirect URLs must include `https://pahuway-cafe.vercel.app/**` (already there). Add `https://padaya.online/**` if customers use that address.

Until step 3 is done, the Google button tells customers to use their mobile number or email instead.

## Landing page (app.padaya.online)
The welcome page has a **hero** (photo, greeting, *Order food & drinks* / *Book a scooter*). Below it are **shortcuts**: signed-in customers see their latest order with **Order again** and their latest booking, and guests see their saved links and a sign-in prompt. The two big **Order food & drinks** / **Book a scooter** cards sit right under the welcome header (logo, your card text, open/booking status). Below the shortcuts, two **preview cards** show 4 menu photos and 4 scooter photos (the first ones in menu / scooter order) with a button each.

Under the two cards there's an **info strip** (delivery from ₱…, ready in ~… min) and **What are you craving?**, a row of menu categories that opens the menu at that section. The scooter card shows the starting price per day. Accents use the Padaya orange family; there's no green on the landing page.

To edit it, go to **Settings → Branding → Welcome page**:
- **Text colour** (welcome banner and both Home cards): *Automatic* picks white or dark for readability. Tick it to choose your own colour; Settings warns if it's hard to read (below 4.5:1). Migration 0030.
- **Welcome banner colour**: tick *Use a banner colour instead of a photo* to show your exact colour with no darkening. The text switches between white and dark automatically, and a live preview shows the result. Untick it to go back to the photo (migration 0029).
- **Welcome page photo** (landscape, 1600 px+). Leave it empty to use the first menu photo.
- **Home page cards**: for each of the two cards (*Order food & drinks* / *Book a scooter*), set the **background colour**, the **logo** (empty = the brand logo) and an optional **background photo** (darkened so the text stays readable). There's a live preview. The text switches between dark and light to suit the colour (migration 0027).

## Footer: Home · Activity · Messages
Customer pages have an app-style footer. It's hidden on checkout and on staff, rider and sign-in screens.
- **Home** opens the landing page.
- **Activity** shows the customer's café orders and scooter rentals (two tabs). Guests are asked to sign in.
- **Messages** is an inbox of automatic updates for signed-in customers, with a red unread badge that updates live:
  - **Orders:** received, being prepared, ready / packed, on the way, completed / delivered, cancelled, GCash verified, refunded.
  - **Bookings:** received, confirmed, picked up, returned, cancelled, deposit refunded.
  - Database triggers write the messages (migration 0026, `customer_messages`). Customers can only read their own. Opening Messages marks them read. Guest orders get no messages.

## Cash for regulars, and order chat
- **Cash on delivery / pickup** unlocks after the customer has **3 completed orders**. Until then the cash option shows a lock and "x of 3", and GCash is selected. The database enforces this too (`place_order`). To change the number, go to **Settings → Cash payments** (0 = cash for everyone). Migration 0028, `store_settings.cash_after_orders`.
- **Chat with your rider**: on a delivery order's page, the signed-in customer and the assigned rider can message each other live.
  - The chat opens once a rider is assigned and closes when the order is completed or cancelled; the messages stay visible.
  - Riders open it from the delivery card (💬 Chat with …). The rider's messages also show in the customer's **Messages** inbox.
  - Only the customer, the assigned rider and staff with Orders access can read it (`order_messages`, sent through `send_order_message`).

## Padaya 2.0, the booking hub (Phase 1)
Padaya is growing into a koobo-style booking app for Tablas: **Food · Scooters · Cars · Stays · Tours**. Cars, stays and tours are marked *coming soon* until their phases ship.
- **Home**: welcome banner → the two main cards → **search** ("food, scooters, cars or stays") with category buttons → info strip → **What are you planning?** tiles with From-prices → swipeable rows **Popular on the menu** and **Scooters and car rentals** (listing cards with ♡) → a stays/tours teaser → your shortcuts.
- **Explore** (footer tab): search everything, filter by category, **♡ Saved** (sign-in required). Cards open the exact item: a menu card opens that item on the menu, and a scooter card pre-selects that scooter on the booking form.
- **Partner-ready**: every listing belongs to a **business** (`businesses`: Pahuway Cafe, Baybayin). New scooters and menu items are linked automatically, so partner businesses can be added later. Favourites are in `favourites` (private to each customer). Migration 0031.
- Next phases: 2 Car rental · 3 Accommodations · 4 Tours (coming-soon sign-ups).
