// Landing page (app.padaya.online/): hero, shortcuts (guest + signed in, Order again), service cards with photos,
// hours / location / contact / how it works, and the Welcome-page settings that feed it.
// Needs local Supabase (migrations + seed) + seed:users + app on :3000.  Run: npm run test:landing
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const { readFileSync } = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(path.join(__dirname, "../.env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const PHONE = "09175550177";
const PASS = "Kape-sa-umaga-1";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("update store_settings set is_open = true, open_time = '00:00', close_time = '23:59', hero_url = null, location_text = null, location_map_url = null, contact_phone = '0917 000 0000'");
  sql("update rental_settings set bookings_enabled = true, terms = coalesce(nullif(terms, ''), 'Test terms.'), messenger_url = 'https://m.me/example'");
  sql("update menu_items set is_sold_out = false where name in ('Americano', 'Café Latte')");

  // a customer with one past order: 2 × Americano (default options) + 1 × Café Latte, Iced
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Rosa Landing", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");
  const cust = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await cust.auth.signInWithPassword({ email: `${PHONE}@phone.invalid`, password: PASS });
  const defaults = (name) => sql(`select coalesce(string_agg(o.id::text, ','), '') from item_options o join menu_item_option_groups m on m.group_id = o.group_id join menu_items i on i.id = m.item_id where i.name = '${name}' and o.is_default`).split(",").filter(Boolean);
  const americano = sql("select id from menu_items where name = 'Americano'");
  const latte = sql("select id from menu_items where name = 'Café Latte'");
  const iced = sql(`select o.id from item_options o join option_groups g on g.id = o.group_id join menu_item_option_groups m on m.group_id = g.id where m.item_id = '${latte}' and o.name = 'Iced'`);
  const latteOpts = [...defaults("Café Latte").filter((id) => sql(`select group_id from item_options where id = '${id}'`) !== sql(`select group_id from item_options where id = '${iced}'`)), iced];
  const placed = await cust.rpc("place_order", {
    p_order: { customer_name: "Rosa Landing", customer_phone: PHONE, order_type: "pickup", payment_method: "cash" },
    p_items: [
      { menu_item_id: americano, quantity: 2, option_ids: defaults("Americano") },
      { menu_item_id: latte, quantity: 1, option_ids: latteOpts },
    ],
  });
  assert(!placed.error, "past order placed " + (placed.error?.message ?? ""));
  const orderNo = placed.data.order_number;

  const browser = await chromium.launch();
  try {
    // ---- guest
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/");
    await g.getByTestId("hero").waitFor();
    await g.getByTestId("hero-rent").getByText("Book a scooter").waitFor();
    assert((await g.getByTestId("welcome-title").textContent()) === "Welcome!" && (await g.getByTestId("hero-order").count()) === 1 && (await g.getByTestId("hero-rent").textContent()) === "Book a scooter", "hero: title and the two buttons (Order food & drinks / Book a scooter)");
    const firstPhoto = sql("select photo_url from menu_items where is_active and not is_sold_out and photo_url is not null order by sort_order, name limit 1");
    await g.waitForFunction((u) => document.querySelector("[data-testid=hero-photo]")?.getAttribute("src") === u, firstPhoto, { timeout: 8000 }).catch(() => null);
    assert((await g.getByTestId("hero-photo").getAttribute("src")) === firstPhoto, "without a chosen photo the hero uses the first menu photo");
    assert((await g.getByTestId("brand-background").count()) === 0, "the old faded background is not shown behind the landing page");
    await g.getByTestId("shortcuts-signin").waitFor();
    assert(true, "guests get a 'Sign in to track your orders…' shortcut");
    assert((await g.getByTestId("cafe-photos").locator("img").count()) >= 1, "café card shows menu photos");
    assert((await g.getByTestId("info").innerText()).includes("Call 0917 000 0000") && (await g.getByTestId("contact-messenger").getAttribute("href")) === "https://m.me/example", "contact: call and Messenger");
    assert((await g.getByTestId("location-text").count()) === 0, "Find us is hidden until a location is set");
    assert((await g.getByTestId("how-it-works").locator("li").count()) === 6, "how it works: 3 steps for ordering, 3 for renting");
    await g.getByTestId("choose-cafe").click();
    await g.waitForURL(BASE + "/menu");
    assert(true, "café card opens the menu");

    // ---- admin sets photo-free settings: location + map link (bad link rejected)
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.goto(BASE + "/admin/settings");
    await admin.getByTestId("landing-settings").waitFor();
    await admin.locator("#location-text").fill("Poblacion, beside the town plaza");
    await admin.locator("#location-map-url").fill("maps.google.com/xyz");
    await admin.getByRole("button", { name: "Save settings" }).click();
    await admin.getByText("Map link must start with https://").waitFor();
    assert(true, "a map link without https:// is refused with a clear message");
    await admin.locator("#location-map-url").fill("https://maps.app.goo.gl/example");
    await admin.getByRole("button", { name: "Save settings" }).click();
    await admin.getByText("Settings saved.").waitFor();
    await g.goto(BASE + "/");
    await g.getByTestId("location-text").waitFor();
    assert((await g.getByTestId("location-text").textContent()) === "Poblacion, beside the town plaza" && (await g.getByTestId("location-map").getAttribute("href")) === "https://maps.app.goo.gl/example", "location and map link from Settings appear under Find us");

    // ---- hero photo from Settings
    sql("update store_settings set hero_url = '/menu/latte.svg'");
    await g.reload();
    await g.waitForFunction(() => document.querySelector("[data-testid=hero-photo]")?.getAttribute("src") === "/menu/latte.svg");
    assert(true, "a chosen Welcome page photo replaces the menu photo in the hero");
    sql("update store_settings set hero_url = null");

    // ---- signed-in customer: latest order + Order again
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    await c.goto(BASE + "/");
    await c.getByTestId("welcome-title").getByText("Welcome, Rosa!").waitFor();
    const sc = c.getByTestId("shortcut-order");
    await sc.waitFor();
    assert((await sc.innerText()).includes(orderNo), "signed in: 'Your latest order' shortcut with its number and status");
    await c.getByTestId("order-again").click();
    await c.waitForURL(BASE + "/checkout");
    const cart = await c.evaluate(() => JSON.parse(localStorage.getItem("pahuway-cart-v1") || "[]"));
    const am = cart.find((l) => l.name === "Americano"), la = cart.find((l) => l.name === "Café Latte");
    assert(cart.length === 2 && am?.quantity === 2 && la?.quantity === 1 && la.options.some((o) => o.name === "Iced"), "Order again puts the same items, quantities and options back in the cart and opens checkout");

    // sold-out items are left out with a note
    await c.evaluate(() => localStorage.removeItem("pahuway-cart-v1"));
    sql("update menu_items set is_sold_out = true where name = 'Americano'");
    await c.goto(BASE + "/");
    await c.getByTestId("order-again").click();
    await c.getByText("1 item isn't available any more").waitFor();
    await c.waitForURL(BASE + "/checkout");
    const cart2 = await c.evaluate(() => JSON.parse(localStorage.getItem("pahuway-cart-v1") || "[]"));
    assert(cart2.length === 1 && cart2[0].name === "Café Latte", "items that are sold out now are left out, with a note");
    console.log("ALL LANDING PAGE CHECKS PASSED");
  } finally {
    sql("update menu_items set is_sold_out = false where name = 'Americano'");
    sql("update store_settings set hero_url = null, location_text = null, location_map_url = null");
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
