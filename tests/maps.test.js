// Delivery map pin: customer pins at checkout (tap / current location / remove), the pin is saved on the order
// and the account, riders get a map + Google Maps / Waze directions, staff see the pin, the server checks it.
// Needs local Supabase (migrations + seed) + seed:users + app on :3000.  Run: npm run test:maps
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const { readFileSync } = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(path.join(__dirname, "../.env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = path.join(__dirname, "../docs/screenshots/");
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const HERE = { latitude: 12.570123, longitude: 122.133456 }; // a spot in San Agustin
const CUSTOMER = { email: "maptest@example.com", password: "MapTest-2026!" };

async function addAmericanoAndCheckout(page) {
  await page.goto(BASE + "/menu");
  await page.locator("article", { hasText: "Double espresso over hot water" }).getByRole("button", { name: /^Add/ }).click();
  await page.getByRole("button", { name: "Increase quantity" }).click(); // 2 × ₱120 clears the ₱200 delivery minimum
  await page.getByRole("button", { name: /^Add · / }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.waitForURL(BASE + "/checkout");
  await page.getByRole("radio", { name: /Delivery/ }).click();
}

(async () => {
  sql("update store_settings set require_account = false, cash_after_orders = 0"); // guest orders/bookings (the sign-in gate has its own test)
  sql("update store_settings set is_open = true, open_time = '00:00', close_time = '23:59'");
  sql("delete from order_items; delete from orders;");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users.filter((u) => u.email === CUSTOMER.email)) await admin.auth.admin.deleteUser(u.id);
  await admin.auth.admin.createUser({ ...CUSTOMER, email_confirm: true });

  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
  const browser = await chromium.launch({ proxy });
  const phone = { ...devices["iPhone 13"], geolocation: HERE, permissions: ["geolocation"] };

  // ---------- 1. guest checkout with a pin ----------
  const cust = await (await browser.newContext(phone)).newPage();
  await addAmericanoAndCheckout(cust);
  const picker = cust.getByTestId("map-picker");
  await picker.waitFor();
  await picker.locator(".leaflet-container").waitFor();
  assert(await picker.getByText("Tap the map to drop a pin").isVisible(), "pin picker shows on delivery, starts empty (optional)");
  await cust.getByRole("radio", { name: /Pickup/ }).click();
  assert((await cust.getByTestId("map-picker").count()) === 0, "pin picker hidden for pickup");
  await cust.getByRole("radio", { name: /Delivery/ }).click();
  await picker.locator(".leaflet-container").waitFor();

  // tap the map
  await picker.locator(".leaflet-container").scrollIntoViewIfNeeded();
  await cust.waitForTimeout(300);
  const box = await picker.locator(".leaflet-container").boundingBox();
  await cust.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await picker.getByText("Pinned ✓").waitFor();
  assert((await picker.locator(".isla-pin").count()) === 1, "tapping the map drops a pin");
  await picker.getByRole("button", { name: "Remove pin" }).click();
  assert((await picker.locator(".isla-pin").count()) === 0, "Remove pin clears it");

  // use my current location
  await picker.getByRole("button", { name: /Use my current location/ }).click();
  await picker.getByText("Pinned ✓").waitFor();
  assert((await picker.locator(".isla-pin").count()) === 1, "Use my current location drops the pin");

  await cust.fill("#name", "Ana Reyes");
  await cust.fill("#phone", "09171234567");
  await cust.selectOption("#zone", { label: "Poblacion — ₱30 delivery" });
  await cust.fill("#street", "Purok 2, Mabini St.");
  await cust.fill("#landmark", "Near the sari-sari store");
  await cust.waitForTimeout(1200); // let tiles render for the screenshot
  await picker.screenshot({ path: SHOTS + "23-checkout-map-pin.png" });
  await cust.getByRole("button", { name: /Place order/ }).click();
  await cust.waitForURL(/\/order\/[0-9a-f-]{36}/);
  const [lat, lng, id1] = sql("select delivery_lat, delivery_lng, id from orders order by created_at desc limit 1").split("|");
  assert(Number(lat) === HERE.latitude && Number(lng) === HERE.longitude, `order stores the pin (${lat}, ${lng})`);

  // guest's next checkout on the same phone remembers the pin
  await addAmericanoAndCheckout(cust);
  await cust.getByTestId("map-picker").getByText("Pinned ✓").waitFor();
  assert(true, "guest's pin is remembered on this phone for next time");

  // ---------- 2. an order without a pin (still allowed) ----------
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const item = sql("select id from menu_items where name='Americano'");
  const zone = sql("select id from delivery_zones where name='Poblacion'");
  const base = { customer_name: "Ben Cruz", customer_phone: "09181234567", order_type: "delivery", zone_id: zone, street: "Rizal St.", landmark: "Chapel", payment_method: "cash" };
  const items = [{ menu_item_id: item, quantity: 2, option_ids: sql(`select string_agg(o.id::text, ',') from item_options o join menu_item_option_groups m on m.group_id=o.group_id where m.item_id='${item}' and o.is_default`).split(",").filter(Boolean) }];
  const r2 = await anon.rpc("place_order", { p_order: base, p_items: items });
  assert(!r2.error, "order without a pin is accepted (pin is optional) " + (r2.error?.message ?? ""));
  const id2 = sql(`select id from orders where order_number='${r2.data.order_number}'`);
  assert(sql(`select coalesce(delivery_lat::text,'null') from orders where id='${id2}'`) === "null", "no pin stored as empty");

  // ---------- 3. server-side checks ----------
  const bad = async (extra, why) => {
    const r = await anon.rpc("place_order", { p_order: { ...base, ...extra }, p_items: items });
    assert(r.error && /map pin/i.test(r.error.message), `server rejects ${why}: "${r.error?.message}"`);
  };
  await bad({ lat: 51.5, lng: -0.12 }, "a pin outside the Philippines");
  await bad({ lat: 12.57 }, "a pin with only a latitude");
  await bad({ lat: "abc", lng: 122.1 }, "a non-numeric pin");
  const rp = await anon.rpc("place_order", { p_order: { ...base, order_type: "pickup", zone_id: null, lat: 12.57, lng: 122.13 }, p_items: items });
  assert(!rp.error && sql(`select coalesce(delivery_lat::text,'null') from orders where order_number='${rp.data.order_number}'`) === "null", "pickup orders ignore a pin");

  // ---------- 4. rider: map + Google Maps / Waze ----------
  const riderId = sql("select id from riders limit 1");
  sql(`update orders set status='preparing' where id in ('${id1}','${id2}'); update orders set status='ready', rider_id='${riderId}' where id in ('${id1}','${id2}');`);
  const rider = await (await browser.newContext(devices["iPhone 13"])).newPage();
  await rider.goto(BASE + "/login");
  await rider.fill("#email", "rider@pahuway.cafe");
  await rider.fill("#password", "ChangeMe-Rider-2026");
  await rider.click("button:has-text('Sign in')");
  await rider.waitForURL(BASE + "/rider");
  const card1 = rider.locator("article", { hasText: "Ana Reyes" });
  const card2 = rider.locator("article", { hasText: "Ben Cruz" });
  await card1.waitFor();
  const g1 = await card1.getByTestId("nav-google").getAttribute("href");
  const w1 = await card1.getByTestId("nav-waze").getAttribute("href");
  assert(g1.includes(`destination=${HERE.latitude}%2C${HERE.longitude}`), "rider Google Maps button navigates to the pin: " + g1);
  assert(w1.includes(`ll=${HERE.latitude}%2C${HERE.longitude}`) && w1.includes("navigate=yes"), "rider Waze button navigates to the pin: " + w1);
  await card1.locator(".isla-pin").waitFor();
  assert(true, "rider card shows a map preview with the pin");
  const g2 = await card2.getByTestId("nav-google").getAttribute("href");
  const w2 = await card2.getByTestId("nav-waze").getAttribute("href");
  assert(g2.includes(encodeURIComponent("Rizal St., Chapel, Poblacion, San Agustin, Romblon")), "no pin → Google Maps falls back to the typed address");
  assert(w2.includes("q=") && w2.includes("Rizal"), "no pin → Waze searches the typed address");
  assert((await card2.locator(".leaflet-container").count()) === 0 && (await card2.getByText("No map pin").isVisible()), "no pin → no map, short note instead");
  await rider.waitForTimeout(1200);
  await card1.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72));
  await rider.screenshot({ path: SHOTS + "24-rider-map.png" });

  // ---------- 5. staff order panel ----------
  const staff = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
  await staff.goto(BASE + "/login");
  await staff.fill("#email", "admin@pahuway.cafe");
  await staff.fill("#password", "ChangeMe-Admin-2026");
  await staff.click("button:has-text('Sign in')");
  await staff.waitForURL(BASE + "/admin");
  await staff.getByText("Ana Reyes").first().click();
  const link = await staff.getByTestId("staff-pin-link").getAttribute("href");
  assert(link.includes(`query=${HERE.latitude}%2C${HERE.longitude}`), "staff order panel links to the pinned location");

  // ---------- 6. signed-in customer: pin saved on the account ----------
  const acct = await (await browser.newContext({ ...phone, geolocation: { latitude: 12.565, longitude: 122.128 } })).newPage();
  await acct.goto(BASE + "/login");
  await acct.fill("#email", CUSTOMER.email);
  await acct.fill("#password", CUSTOMER.password);
  await acct.click("button:has-text('Sign in')");
  await acct.waitForURL((u) => !u.pathname.startsWith("/login"));
  await acct.goto(BASE + "/account");
  await acct.getByRole("button", { name: /Use my current location/ }).click();
  await acct.getByText("Pinned ✓").waitFor();
  await acct.getByRole("button", { name: "Save", exact: true }).click();
  await acct.getByText("Saved!").waitFor();
  assert(sql(`select saved_lat || ',' || saved_lng from users where email='${CUSTOMER.email}'`) === "12.565000,122.128000", "account page saves the pin");
  await addAmericanoAndCheckout(acct);
  await acct.getByTestId("map-picker").getByText("Pinned ✓").waitFor();
  assert(true, "checkout pre-fills the account's saved pin");
  // a new pin at checkout updates the account
  await acct.context().setGeolocation({ latitude: 12.571, longitude: 122.135 });
  await acct.getByRole("button", { name: /Use my current location/ }).click();
  await acct.fill("#name", "Map Tester");
  await acct.fill("#phone", "09191234567");
  await acct.selectOption("#zone", { label: "Poblacion — ₱30 delivery" });
  await acct.fill("#street", "Purok 1");
  await acct.waitForFunction(() => document.querySelector("[data-testid=map-picker]")?.textContent?.includes("Pinned"));
  await acct.getByRole("button", { name: /Place order/ }).click();
  await acct.waitForURL(/\/order\//);
  assert(sql(`select saved_lat || ',' || saved_lng from users where email='${CUSTOMER.email}'`) === "12.571000,122.135000", "pin used at checkout is saved to the account for next time");

  await browser.close();
  sql("delete from order_items; delete from orders;"); // leave the rider list empty for the other suites
  await admin.auth.admin.deleteUser((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === CUSTOMER.email).id);
  console.log("\nAll map checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
