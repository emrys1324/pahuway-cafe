// Several food stores (R2): staff switch on Kusina sa Hiraya (Stores page) and edit its menu (Menu → store picker);
// customers see Food delivery (store list), open a store's menu, order (one store per cart), the order page names the
// store; staff see the store on the Orders board; closed store and mixed carts are refused by the database.
// Needs local Supabase + seed:users + app on :3000.  Run: npm run test:food
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
const PHONE = "09175550188";
const PASS = "Kape-sa-umaga-1";
const K = "kusina-sa-hiraya";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql(`delete from menu_items where name = 'Spicy Miso Ramen'`);
  sql(`update businesses set is_active = false, is_open = true, open_time = '10:00', close_time = '21:00' where slug = '${K}'`);
  sql("update store_settings set require_account = true, cash_after_orders = 0, is_open = true, open_time = '00:00', close_time = '23:59'");
  sql("update menu_items set is_sold_out = false where name in ('Americano', 'Shoyu Ramen')");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Fe Food", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");

  const browser = await chromium.launch();
  try {
    // ---- before: Kusina is hidden
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/food");
    await g.getByTestId("store-list").waitFor();
    assert((await g.getByTestId("store-list").getByRole("link").count()) === 1 && (await g.getByTestId(`store-${K}`).count()) === 0, "Food delivery lists only Pahuway Cafe while Kusina sa Hiraya is hidden");
    await g.goto(BASE + `/food/${K}`);
    await g.getByTestId("store-missing").waitFor();
    assert(true, "a hidden store's page says it isn't on Padaya right now");

    // ---- staff: Stores → Kusina sa Hiraya: show it, hours 00:00–23:59
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.getByRole("link", { name: "Stores", exact: true }).first().click();
    await admin.waitForURL(BASE + "/admin/stores");
    const row = admin.getByTestId("admin-store").filter({ hasText: "Kusina sa Hiraya" });
    await row.waitFor();
    assert(/hidden/i.test(await row.innerText()) && (await row.innerText()).includes("Ramen, dimsum & more"), "Stores lists Kusina sa Hiraya (hidden, Ramen, dimsum & more)");
    await row.getByRole("button", { name: "Edit" }).click();
    const f = admin.getByTestId("store-form");
    await f.getByRole("switch", { name: "Show to customers" }).click();
    await f.getByLabel("Opens").fill("00:00");
    await f.getByLabel("Closes").fill("23:59");
    await f.getByRole("button", { name: "Save store" }).click();
    await row.getByText("Open now").waitFor();
    assert(sql(`select is_active || '|' || open_time || '|' || close_time from businesses where slug = '${K}'`) === "true|00:00:00|23:59:00", "staff show the store and set its hours");

    // ---- staff: Menu → pick Kusina → add an item
    await row.getByRole("link", { name: "Menu" }).click();
    await admin.waitForURL(/\/admin\/menu\?store=/);
    await admin.getByText("Shoyu Ramen").first().waitFor();
    assert((await admin.getByText("Americano").count()) === 0, "Menu opens on Kusina sa Hiraya's menu only (no café drinks)");
    await admin.getByRole("button", { name: /Add item/ }).click();
    await admin.locator("#i-name").fill("Spicy Miso Ramen");
    await admin.locator("#i-price").fill("280");
    await admin.locator("#i-cat").selectOption({ label: "Mains" });
    await admin.getByRole("button", { name: /^Save/ }).last().click();
    await admin.getByText("Spicy Miso Ramen").first().waitFor();
    assert(sql(`select b.slug from menu_items m join businesses b on b.id = m.business_id where m.name = 'Spicy Miso Ramen'`) === K, "a new item added there belongs to Kusina sa Hiraya");

    // ---- customer: Food delivery → Kusina → order
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    c.on("dialog", (d) => d.accept());
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    await c.goto(BASE + "/");
    await c.getByTestId("cat-food").getByText("2 stores").waitFor({ timeout: 10000 });
    assert((await c.getByTestId(`brand-${K}`).count()) === 1, "Home: Food delivery says 2 stores; Kusina sa Hiraya is in Our brands");
    await c.getByTestId("nav-food").click();
    await c.waitForURL(BASE + "/food");
    await c.getByTestId(`store-${K}`).waitFor();
    assert((await c.getByTestId("store-list").getByRole("link").count()) === 2 && (await c.getByTestId(`store-${K}`).innerText()).includes("Open"), "Food tab: both stores, Kusina open");
    await c.getByTestId(`store-${K}`).click();
    await c.waitForURL(BASE + `/food/${K}`);
    await c.getByTestId("store-head").getByText("Kusina sa Hiraya").waitFor();
    assert((await c.locator("article").count()) === 7 && (await c.getByText("Americano").count()) === 0, "the store page shows only its own 7 items");
    await c.locator("article", { hasText: "Shoyu Ramen" }).getByRole("button", { name: /^Add/ }).click();
    await c.getByRole("button", { name: /^Add · / }).click();
    await c.getByRole("button", { name: /View cart/ }).click();
    await c.getByRole("link", { name: "Checkout" }).click();
    await c.waitForURL(BASE + "/checkout");
    await c.getByTestId("checkout-store").getByText("Kusina sa Hiraya").waitFor();
    assert(await c.getByRole("button", { name: "Schedule" }).isDisabled(), "checkout names the store; other stores take ASAP orders only");
    await c.getByRole("radio", { name: /Pickup/ }).click();
    await c.getByRole("radio", { name: /Cash/ }).first().click().catch(() => null);
    await c.getByRole("button", { name: /Place order/ }).click();
    await c.waitForURL(/\/order\//, { timeout: 20000 });
    await c.getByTestId("order-store").getByText("Kusina sa Hiraya").waitFor();
    const placed = sql(`select o.order_number || '|' || b.slug from orders o join businesses b on b.id = o.business_id where o.customer_phone = '${PHONE}' order by o.created_at desc limit 1`).split("|");
    assert(placed[1] === K, `order ${placed[0]} is saved as a Kusina sa Hiraya order; its page names the store`);

    // ---- one store per cart
    await c.goto(BASE + `/food/${K}`);
    await c.locator("article", { hasText: "Pork Gyoza" }).getByRole("button", { name: /^Add/ }).click();
    await c.getByRole("button", { name: /^Add · / }).click();
    await c.goto(BASE + "/menu");
    await c.getByTestId("other-cart").getByText("Kusina sa Hiraya").waitFor();
    await c.locator("article", { hasText: "Double espresso over hot water" }).getByRole("button", { name: /^Add/ }).click();
    await c.getByRole("button", { name: /^Add · / }).click();
    await c.waitForFunction(() => { try { const l = JSON.parse(localStorage.getItem("pahuway-cart-v1") || "[]"); return l.length === 1 && l[0].name === "Americano"; } catch { return false; } });
    assert(true, "adding a café drink to a Kusina cart asks to start a new cart; the cart then holds only the café drink");

    // ---- staff Orders board
    await admin.goto(BASE + "/admin");
    await admin.getByText(placed[0]).first().waitFor();
    assert((await admin.getByTestId("order-store-badge").filter({ hasText: "Kusina sa Hiraya" }).count()) >= 1, "Orders board shows which store the order is for");
    await admin.getByTestId("store-filter").selectOption({ label: "Pahuway Cafe" });
    await admin.waitForTimeout(400);
    assert((await admin.getByText(placed[0]).count()) === 0, "filtering by Pahuway Cafe hides the Kusina order");

    // ---- the database refuses closed stores and mixed carts
    const cust = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cust.auth.signInWithPassword({ email: `${PHONE}@phone.invalid`, password: PASS });
    const ramen = sql("select id from menu_items where name = 'Shoyu Ramen'");
    const amer = sql("select id from menu_items where name = 'Americano'");
    const opts = sql(`select coalesce(string_agg(o.id::text, ','), '') from item_options o join menu_item_option_groups m on m.group_id = o.group_id where m.item_id = '${amer}' and o.is_default`).split(",").filter(Boolean);
    const base = { customer_name: "Fe Food", customer_phone: PHONE, order_type: "pickup", payment_method: "cash" };
    const mixed = await cust.rpc("place_order", { p_order: base, p_items: [{ menu_item_id: ramen, quantity: 1 }, { menu_item_id: amer, quantity: 1, option_ids: opts }] });
    assert(mixed.error && /more than one store/.test(mixed.error.message), "an order with items from two stores is refused");
    sql(`update businesses set is_open = false where slug = '${K}'`);
    const closed = await cust.rpc("place_order", { p_order: base, p_items: [{ menu_item_id: ramen, quantity: 1 }] });
    assert(closed.error && /STORE_CLOSED: Kusina sa Hiraya is closed/.test(closed.error.message), "a closed store can't take orders, even while the café is open");
    const cafe = await cust.rpc("place_order", { p_order: base, p_items: [{ menu_item_id: amer, quantity: 1, option_ids: opts }] });
    assert(!cafe.error && sql(`select b.slug from orders o join businesses b on b.id = o.business_id where o.order_number = '${cafe.data?.order_number}'`) === "pahuway-cafe", "the café still takes orders (saved as Pahuway Cafe)");
    await c.goto(BASE + `/food/${K}`);
    await c.getByText("Kusina sa Hiraya is closed right now.").waitFor();
    assert(true, "the store page says it's closed");
    console.log("ALL FOOD STORE CHECKS PASSED");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
