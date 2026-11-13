// Landing page (app.padaya.online/): hero, shortcuts (guest + signed in, Order again), service cards with photos,
// no extra info cards, and the Welcome-page photo setting.
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
    await g.getByTestId("choose-scooter").getByText("Book a scooter").waitFor();
    assert((await g.getByTestId("welcome-title").textContent()) === "Welcome!" && (await g.getByTestId("hero").getByRole("link").count()) === 0, "welcome header: title only, no buttons inside it");
    const pos = await g.evaluate(() => {
      const r = (id) => document.querySelector(`[data-testid=${id}]`).getBoundingClientRect();
      return { heroBottom: r("hero").bottom, actions: r("main-actions"), shortcuts: document.querySelector("[data-testid=shortcuts]")?.getBoundingClientRect().top ?? 1e9, vh: innerHeight };
    });
    assert(pos.actions.top > pos.heroBottom && pos.actions.top - pos.heroBottom < 40 && pos.actions.bottom < pos.shortcuts && pos.actions.bottom <= pos.vh, "Order food & drinks / Book a scooter cards sit right under the welcome header, above everything else, on the first screen of a phone");
    const [o, r] = [await g.getByTestId("choose-cafe").boundingBox(), await g.getByTestId("choose-scooter").boundingBox()];
    assert(Math.abs(o.y - r.y) < 2 && Math.abs(o.width - r.width) < 2, "the two cards sit side by side, same size");
    const firstPhoto = sql("select photo_url from menu_items where is_active and not is_sold_out and photo_url is not null order by sort_order, name limit 1");
    await g.waitForFunction((u) => document.querySelector("[data-testid=hero-photo]")?.getAttribute("src") === u, firstPhoto, { timeout: 8000 }).catch(() => null);
    assert((await g.getByTestId("hero-photo").getAttribute("src")) === firstPhoto, "without a chosen photo the hero uses the first menu photo");
    assert((await g.getByTestId("brand-background").count()) === 0, "the old faded background is not shown behind the landing page");
    await g.getByTestId("shortcuts-signin").waitFor();
    assert(true, "guests get a 'Sign in to track your orders…' shortcut");
    assert((await g.getByTestId("cafe-photos").count()) === 0 && (await g.getByTestId("scooter-photos").count()) === 0 && (await g.locator("main a[href='/menu']").count()) === 1 && (await g.locator("main a[href='/baybayin']").count()) === 1, "no photo cards below: the top two cards are the only way to the menu and Baybayin");
    assert((await g.getByTestId("choose-cafe").innerText()).includes("Open now · until"), "café card shows open now / until");
    assert((await g.locator("[data-testid=info], [data-testid=how-it-works]").count()) === 0 && !(await g.locator("main").innerText()).match(/Opening hours|How it works|Find us|Contact us/), "no Opening hours, How it works, Find us or Contact us on the landing page");
    await g.getByTestId("choose-cafe").click();
    await g.waitForURL(BASE + "/menu");
    await g.goBack();
    await g.getByTestId("choose-scooter").click();
    await g.waitForURL(BASE + "/baybayin");
    assert(true, "Order food & drinks opens the menu; Book a scooter opens Baybayin");

    // ---- Settings: welcome photo only (location fields removed)
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.goto(BASE + "/admin/settings");
    await admin.getByTestId("landing-settings").waitFor();
    assert((await admin.locator("#location-text").count()) === 0 && (await admin.locator("input[aria-label='Upload welcome page photo']").count()) === 1, "Settings → Welcome page has the photo upload and no location fields");

    // ---- hero photo from Settings
    sql("update store_settings set hero_url = '/menu/latte.svg'");
    await g.goto(BASE + "/");
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
