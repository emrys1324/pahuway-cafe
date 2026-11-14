// Checkout: Delivery / Pickup / Dine-in order, "Use my current location" above the address, cash only after
// 3 completed orders. Order page: live chat between the customer and the assigned rider.
// Needs local Supabase (migrations + seed) + seed:users + app on :3000.  Run: npm run test:checkout
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
const PHONE = "09175550155";
const PASS = "Kape-sa-umaga-1";

async function cartAndCheckout(page) {
  await page.goto(BASE + "/menu");
  await page.locator("article", { hasText: "Double espresso over hot water" }).getByRole("button", { name: /^Add/ }).click();
  await page.getByRole("button", { name: /^Add · / }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.waitForURL(BASE + "/checkout");
  await page.locator("#name").waitFor();
}

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("update store_settings set require_account = true, cash_after_orders = 3, is_open = true, open_time = '00:00', close_time = '23:59'");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Carla Chat", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");
  const uid = sql(`select id from auth.users where email = '${PHONE}@phone.invalid'`);

  const browser = await chromium.launch();
  try {
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();

    // ---- order type order + default
    await cartAndCheckout(c);
    const types = await c.getByRole("radiogroup", { name: "Order type" }).getByRole("radio").allInnerTexts();
    assert(types.map((t) => t.split("\n").filter(Boolean)[1] ?? t).map((t) => t.trim()).join("|").replace(/[^A-Za-z|-]/g, "") === "Delivery|Pickup|Dine-in", `order types read Delivery, Pickup, Dine-in (${types.map((t) => t.replace(/\s+/g, " ")).join(" / ")})`);
    assert((await c.getByRole("radio", { name: /Delivery/ }).getAttribute("aria-checked")) === "true", "Delivery is selected first");

    // ---- address layout: barangay → current location (map) → street → landmark
    const ys = await c.evaluate(() => {
      const top = (el) => el.getBoundingClientRect().top;
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Use my current location"));
      return [top(document.querySelector("#zone")), top(btn), top(document.querySelector("#street")), top(document.querySelector("#landmark"))];
    });
    assert(ys[0] < ys[1] && ys[1] < ys[2] && ys[2] < ys[3], "Barangay, then Use my current location, then House no. / Street / Purok, then Landmark");

    if (process.env.SHOTS) await c.evaluate(() => window.scrollTo(0, document.querySelector("#zone").getBoundingClientRect().top + window.scrollY - 330)), await c.waitForTimeout(600), await c.screenshot({ path: process.env.SHOTS + "50-checkout-delivery-first.png" });
    // ---- cash locked for a new customer
    const cash = c.getByTestId("pay-cash");
    assert((await cash.isDisabled()) && (await cash.innerText()).includes("0 of 3"), "cash is locked for a new customer (0 of 3 completed orders)");
    assert((await c.getByTestId("pay-gcash").getAttribute("aria-checked")) === "true", "GCash is selected instead");
    if (process.env.SHOTS) await c.getByTestId("pay-cash").scrollIntoViewIfNeeded(), await c.evaluate(() => window.scrollBy(0, -120)), await c.waitForTimeout(400), await c.screenshot({ path: process.env.SHOTS + "51-checkout-cash-locked.png" });
    // three completed orders → cash unlocks
    sql(`insert into orders (order_number, customer_id, customer_name, customer_phone, order_type, subtotal, delivery_fee, total, payment_method, status)
         select 'PH-C' || g, '${uid}', 'Carla Chat', '${PHONE}', 'pickup', 100, 0, 100, 'gcash', 'completed' from generate_series(1, 2) g`);
    await c.reload();
    await c.locator("#name").waitFor();
    await c.waitForTimeout(800);
    assert((await c.getByTestId("pay-cash").isDisabled()) && (await c.getByTestId("pay-cash").innerText()).includes("2 of 3"), "still locked at 2 of 3");
    sql(`insert into orders (order_number, customer_id, customer_name, customer_phone, order_type, subtotal, delivery_fee, total, payment_method, status)
         values ('PH-C3', '${uid}', 'Carla Chat', '${PHONE}', 'pickup', 100, 0, 100, 'gcash', 'completed')`);
    await c.reload();
    await c.locator("#name").waitFor();
    await c.waitForFunction(() => !document.querySelector("[data-testid=pay-cash]").disabled, null, { timeout: 8000 });
    await c.getByTestId("pay-cash").click();
    assert((await c.getByTestId("pay-cash").getAttribute("aria-checked")) === "true" && (await c.getByTestId("pay-cash").innerText()).includes("Cash on delivery"), "after 3 completed orders, Cash on delivery can be chosen");

    // ---- Settings: the number is editable
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.goto(BASE + "/admin/settings");
    await admin.locator("#cash-after").fill("5");
    await admin.getByRole("button", { name: "Save settings" }).click();
    await admin.getByText("Settings saved.").waitFor();
    assert(sql("select cash_after_orders from store_settings") === "5", "Settings → Cash payments: the number of orders is editable");
    await c.reload();
    await c.locator("#name").waitFor();
    await c.waitForFunction(() => document.querySelector("[data-testid=pay-cash]")?.textContent.includes("3 of 5"), null, { timeout: 8000 });
    assert(true, "checkout follows the new number (3 of 5)");
    sql("update store_settings set cash_after_orders = 3");

    // ---- chat: place a delivery order (GCash) as this customer
    const cust = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cust.auth.signInWithPassword({ email: `${PHONE}@phone.invalid`, password: PASS });
    const item = sql("select id from menu_items where name = 'Americano'");
    const opts = sql(`select coalesce(string_agg(o.id::text, ','), '') from item_options o join menu_item_option_groups m on m.group_id = o.group_id where m.item_id = '${item}' and o.is_default`).split(",").filter(Boolean);
    const zone = sql("select id from delivery_zones where name = 'Poblacion'");
    const placed = await cust.rpc("place_order", {
      p_order: { customer_name: "Carla Chat", customer_phone: PHONE, order_type: "delivery", zone_id: zone, street: "Rizal St.", payment_method: "gcash", payment_proof_path: "proofs/test.jpg" },
      p_items: [{ menu_item_id: item, quantity: 2, option_ids: opts }],
    });
    assert(!placed.error, "delivery order placed " + (placed.error?.message ?? ""));
    const { order_number: no, token } = placed.data;
    await c.goto(BASE + "/order/" + token);
    const chat = c.getByTestId("order-chat");
    await chat.waitFor();
    assert((await chat.locator("input[aria-label=Message]").count()) === 0 && (await chat.innerText()).includes("once one is assigned"), "order page: chat box shows, and opens once a rider is assigned");

    // assign the rider → chat opens live
    sql(`update orders set status = 'preparing', rider_id = (select r.id from riders r join auth.users a on a.id = r.user_id where a.email = 'rider@pahuway.cafe') where order_number = '${no}'`);
    await chat.locator("input[aria-label=Message]").waitFor({ timeout: 10000 });
    await chat.locator("input[aria-label=Message]").fill("Blue gate po, beside the chapel");
    await chat.getByRole("button", { name: "Send" }).click();
    await chat.getByText("Blue gate po, beside the chapel").waitFor();
    assert(true, "customer can message once the rider is assigned");

    // rider sees it on their deliveries screen and replies
    const r = await (await browser.newContext(devices["Pixel 7"])).newPage();
    await r.goto(BASE + "/rider/login");
    await r.locator("#rider-email").fill("rider@pahuway.cafe");
    await r.locator("#rider-password").fill("ChangeMe-Rider-2026");
    await r.getByRole("button", { name: "Sign in" }).click();
    await r.waitForURL(BASE + "/rider");
    const card = r.locator("article", { hasText: no });
    await card.getByTestId("rider-open-chat").click();
    const rchat = card.getByTestId("order-chat");
    await rchat.getByText("Blue gate po, beside the chapel").waitFor();
    assert(true, "rider opens the chat on the delivery card and sees the customer's message");
    await rchat.locator("input[aria-label=Message]").fill("Malapit na po!");
    await rchat.getByRole("button", { name: "Send" }).click();
    await chat.getByText("Malapit na po!").waitFor({ timeout: 10000 });
    const bubbles = await chat.getByTestId("chat-message").evaluateAll((els) => els.map((e) => (e.dataset.mine ? "me:" : "them:") + e.innerText.split("\n").find((l) => l && !/^(Rider|Jun)/.test(l))));
    assert(bubbles.length === 2 && bubbles[0].startsWith("me:Blue gate") && bubbles[1].startsWith("them:Malapit"), "the rider's reply appears on the customer's page live (customer right, rider left)");
    if (process.env.SHOTS) await chat.scrollIntoViewIfNeeded(), await c.waitForTimeout(500), await c.screenshot({ path: process.env.SHOTS + "52-order-chat-customer.png" }), await rchat.scrollIntoViewIfNeeded(), await r.waitForTimeout(500), await r.screenshot({ path: process.env.SHOTS + "53-order-chat-rider.png" });
    assert(sql(`select count(*) from customer_messages where user_id = '${uid}' and title = 'Rider · order ${no}'`) === "1", "the rider's message also goes to the customer's Messages inbox");

    // delivered → chat closes
    sql(`update orders set status = 'completed' where order_number = '${no}'`);
    await chat.getByText("chat is closed too").waitFor({ timeout: 10000 });
    assert((await chat.locator("input[aria-label=Message]").count()) === 0 && (await chat.getByTestId("chat-message").count()) === 2, "after delivery the chat closes but the messages stay visible");

    // pickup orders have no chat
    const pickup = await cust.rpc("place_order", { p_order: { customer_name: "Carla Chat", customer_phone: PHONE, order_type: "pickup", payment_method: "cash" }, p_items: [{ menu_item_id: item, quantity: 1, option_ids: opts }] });
    assert(!pickup.error, "regular customer can now pay cash " + (pickup.error?.message ?? ""));
    await c.goto(BASE + "/order/" + pickup.data.token);
    await c.getByText(pickup.data.order_number).first().waitFor();
    await c.waitForTimeout(1500);
    assert((await c.getByTestId("order-chat").count()) === 0, "pickup orders have no rider chat");
    console.log("ALL CHECKOUT & CHAT CHECKS PASSED");
  } finally {
    sql("update store_settings set require_account = false, cash_after_orders = 0");
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
