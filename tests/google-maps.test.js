// Google Maps mode: live map + address fields kept in sync (suggestions, barangay centring, fill-from-pin),
// rider/staff previews, and automatic fallback to OpenStreetMap if Google rejects the key.
// Google's API is replaced by tests/fixtures/mock-google-maps.js.
// Needs local Supabase + seed:users + the app built and started WITH a (fake) key:
//   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=test-key npx next build && npx next start -p 3000
// Run: npm run test:google-maps
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const { readFileSync } = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(path.join(__dirname, "../.env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const MOCK = readFileSync(path.join(__dirname, "fixtures/mock-google-maps.js"), "utf8");
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const CUSTOMER = { email: "gmaptest@example.com", password: "GMapTest-2026!" };
const zoneId = (name) => sql(`select id from delivery_zones where name='${name}'`);

async function newPhone(browser, { authFail = false } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], geolocation: { latitude: 12.5695, longitude: 122.1325 }, permissions: ["geolocation"] });
  await ctx.route("https://maps.googleapis.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
  if (authFail) await ctx.addInitScript(() => (window.__gmMockAuthFail = true));
  return ctx.newPage();
}
async function toCheckout(page) {
  await page.goto(BASE + "/menu");
  await page.locator("article", { hasText: "Double espresso over hot water" }).getByRole("button", { name: /^Add/ }).click();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await page.getByRole("button", { name: /^Add · / }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.waitForURL(BASE + "/checkout");
  await page.getByRole("radio", { name: /Delivery/ }).click();
  await page.getByTestId("google-map").waitFor();
  await page.waitForFunction(() => window.__gm?.maps?.length > 0);
}
const gm = (page) => page.evaluate(() => ({ calls: window.__gm.calls, center: window.__gm.maps.at(-1).center, url: window.__gm.url, pins: window.__gm.markers.filter((m) => m.map).map((m) => m.position) }));

(async () => {
  sql("update store_settings set require_account = false"); // guest orders/bookings (the sign-in gate has its own test)
  sql("update store_settings set is_open = true, open_time = '00:00', close_time = '23:59'");
  sql("delete from order_items; delete from orders;");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  for (const u of (await admin.auth.admin.listUsers()).data.users.filter((u) => u.email === CUSTOMER.email)) await admin.auth.admin.deleteUser(u.id);
  await admin.auth.admin.createUser({ ...CUSTOMER, email_confirm: true });
  const browser = await chromium.launch();

  // ---------- 1. checkout: barangay → map, suggestions → pin ----------
  const a = await newPhone(browser);
  await toCheckout(a);
  let s = await gm(a);
  assert(s.url.includes("key=test-key") && /libraries=places%2Cmarker%2Cgeocoding/.test(s.url) && s.url.includes("region=PH"), "Google Maps loads with the site's key, Places + geocoding, PH region");
  assert((await a.locator(".leaflet-container").count()) === 0, "Google map replaces OpenStreetMap when a key is set");

  await a.selectOption("#zone", { label: "Carmen — ₱50 delivery" });
  await a.waitForFunction(() => window.__gm.maps.at(-1).center.lat === 12.58);
  s = await gm(a);
  assert(s.center.lng === 122.14 && s.calls.some((c) => c.fn === "geocode" && c.req.address === "Carmen, San Agustin, Romblon, Philippines"), "choosing a barangay centres the map on it (no pin yet)");
  assert(s.pins.length === 0, "…without dropping a pin");

  const street = a.locator("#street");
  await street.fill("Mab");
  const list = a.getByRole("listbox", { name: "Address suggestions" });
  await list.waitFor();
  assert((await list.getByRole("option").count()) === 2 && (await list.getByText("Suggestions by Google").isVisible()), "typing the street shows Google suggestions (with attribution)");
  s = await gm(a);
  const sug = s.calls.filter((c) => c.fn === "suggest");
  assert(sug.at(-1).regions.join() === "ph" && sug.at(-1).bias.radius > 0, "suggestions are limited to the Philippines and biased to San Agustin");
  assert(sug.length <= 2, `lookups are debounced while typing (${sug.length} request(s) for 3 letters)`);
  await street.press("ArrowDown");
  await street.press("Enter");
  await a.getByTestId("map-picker").getByText("Pinned on the map").waitFor();
  s = await gm(a);
  assert((await street.inputValue()) === "Mabini Street", "picking a suggestion fills the street");
  assert(s.pins.length === 1 && s.pins[0].lat === 12.5811 && s.pins[0].lng === 122.1411, "…and moves the pin to that address");
  assert((await a.locator("#zone").inputValue()) === zoneId("Carmen"), "…barangay the customer chose is kept");
  assert(s.calls.some((c) => c.fn === "fetchFields" && c.fields.includes("location")), "place details fetched for the pick");

  // drag to the exact door → typed street is not overwritten
  await a.evaluate(() => window.__gm.drag(12.58123, 122.14123));
  await a.waitForTimeout(400);
  assert((await street.inputValue()) === "Mabini Street", "dragging the pin never overwrites what's already filled in");
  await a.fill("#name", "Lia Ramos");
  await a.fill("#phone", "09171112222");
  await a.getByRole("button", { name: /Place order/ }).click();
  await a.waitForURL(/\/order\//);
  const [olat, olng, oid] = sql("select delivery_lat, delivery_lng, id from orders order by created_at desc limit 1").split("|");
  assert(Number(olat) === 12.58123 && Number(olng) === 122.14123, "order saves the dragged pin");

  // ---------- 2. checkout: pin first → fields fill in ----------
  const b = await newPhone(browser);
  await toCheckout(b);
  await b.getByTestId("map-picker").getByRole("button", { name: /Use my current location/ }).click();
  await b.getByText(/Filled in the street, landmark, barangay from the map/).waitFor();
  assert((await b.locator("#street").inputValue()) === "Rizal Street", "pin → street filled from the map (plus codes skipped)");
  assert((await b.locator("#landmark").inputValue()) === "San Agustin Parish Church", "pin → landmark filled with the nearby place");
  assert((await b.locator("#zone").inputValue()) === zoneId("Poblacion"), "pin → barangay matched to a delivery zone (fee applies)");
  await b.getByText("Delivery fee").first().waitFor();

  // ---------- 3. Google rejects the key → OpenStreetMap ----------
  const c = await newPhone(browser, { authFail: true });
  await toCheckout(c).catch(() => {});
  await c.getByTestId("map-picker").locator(".leaflet-container").waitFor({ timeout: 10000 });
  assert((await c.getByTestId("google-map").count()) === 0, "if Google rejects the key, the map switches to OpenStreetMap");
  assert((await c.locator("#street").getAttribute("role")) === null, "…and the street field becomes a plain input");

  // ---------- 4. rider + staff previews ----------
  const riderId = sql("select id from riders limit 1");
  sql(`update orders set status='preparing' where id='${oid}'; update orders set status='ready', rider_id='${riderId}' where id='${oid}';`);
  const rctx = await browser.newContext(devices["iPhone 13"]);
  await rctx.route("https://maps.googleapis.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
  const rider = await rctx.newPage();
  await rider.goto(BASE + "/login");
  await rider.fill("#email", "rider@pahuway.cafe");
  await rider.fill("#password", "ChangeMe-Rider-2026");
  await rider.click("button:has-text('Sign in')");
  await rider.waitForURL(BASE + "/rider");
  const card = rider.locator("article", { hasText: "Lia Ramos" });
  await card.getByTestId("google-map").locator(".isla-pin").waitFor();
  const rm = await rider.evaluate(() => ({ opts: window.__gm.maps[0].opts, m: window.__gm.markers[0] }));
  assert(rm.opts.gestureHandling === "none" && rm.m.gmpDraggable === false, "rider card: still Google map preview with the pin (not draggable)");
  assert((await card.getByTestId("nav-google").getAttribute("href")).includes("12.58123%2C122.14123"), "rider Google Maps button still goes to the pin");

  const sctx = await browser.newContext(devices["iPad (gen 7) landscape"]);
  await sctx.route("https://maps.googleapis.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
  const staff = await sctx.newPage();
  await staff.goto(BASE + "/login");
  await staff.fill("#email", "admin@pahuway.cafe");
  await staff.fill("#password", "ChangeMe-Admin-2026");
  await staff.click("button:has-text('Sign in')");
  await staff.waitForURL(BASE + "/admin");
  await staff.getByText("Lia Ramos").first().click();
  await staff.getByTestId("google-map").locator(".isla-pin").waitFor();
  assert(true, "staff order panel shows the pin on a Google map");

  // ---------- 5. account page ----------
  const acct = await newPhone(browser);
  await acct.goto(BASE + "/login");
  await acct.fill("#email", CUSTOMER.email);
  await acct.fill("#password", CUSTOMER.password);
  await acct.click("button:has-text('Sign in')");
  await acct.waitForURL((u) => !u.pathname.startsWith("/login"));
  await acct.goto(BASE + "/account");
  await acct.locator("#p-street").fill("mabini");
  await acct.getByRole("option", { name: /Mabini Elementary School/ }).click();
  await acct.getByText(/Pinned on the map and filled in the landmark, barangay/).waitFor();
  assert((await acct.locator("#p-street").inputValue()) === "Mabini Street", "account: picking a school fills its street…");
  assert((await acct.locator("#p-landmark").inputValue()) === "Mabini Elementary School", "…uses the school as the landmark…");
  assert((await acct.locator("#p-zone").inputValue()) === zoneId("Carmen"), "…and sets the barangay");
  await acct.getByRole("button", { name: "Save", exact: true }).click();
  await acct.getByText("Saved!").waitFor();
  assert(sql(`select street||'|'||landmark||'|'||saved_lat||','||saved_lng from users where email='${CUSTOMER.email}'`) === "Mabini Street|Mabini Elementary School|12.582200,122.142200", "account saves the synced address and pin");
  const tokens = await acct.evaluate(() => window.__gm.calls.filter((c) => c.fn === "suggest").map((c) => c.token));
  assert(new Set(tokens).size === 1, "one billing session per address search (session token reused)");

  await browser.close();
  sql("delete from order_items; delete from orders;");
  await admin.auth.admin.deleteUser((await admin.auth.admin.listUsers()).data.users.find((u) => u.email === CUSTOMER.email).id);
  console.log("\nAll Google Maps checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
