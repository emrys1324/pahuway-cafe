// Customer footer (Home · Activity · Messages) and the Messages inbox (automatic order/booking updates).
// Needs local Supabase (migrations + seed) + seed:users + app on :3000.  Run: npm run test:nav
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
const PHONE = "09175550166";
const PASS = "Kape-sa-umaga-1";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("update store_settings set is_open = true, open_time = '00:00', close_time = '23:59'");
  sql("update rental_settings set bookings_enabled = true, terms = coalesce(nullif(terms, ''), 'Test terms.')");
  sql("update menu_items set is_sold_out = false where name = 'Americano'");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nina Nav", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");

  const browser = await chromium.launch();
  try {
    // ---- guest: footer on customer pages, hidden on checkout / staff pages
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/");
    const nav = g.getByTestId("bottom-nav");
    await nav.waitFor();
    assert((await nav.getByRole("link").allInnerTexts()).map((t) => t.trim()).join("|") === "Home|Activity|Messages", "footer has Home, Activity and Messages tabs");
    const box = await nav.boundingBox();
    const vh = g.viewportSize().height;
    assert(box.y + box.height >= vh - 1 && (await g.getByTestId("nav-home").getAttribute("aria-current")) === "page", "footer is fixed to the bottom of the screen; Home is the current tab");
    await g.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const lastBottom = await g.evaluate(() => { const els = [...document.querySelectorAll("main > *")]; return els[els.length - 1].getBoundingClientRect().bottom; });
    assert(lastBottom <= box.y + 1, "the page leaves room so the footer never covers content");
    await g.getByTestId("nav-activity").click();
    await g.waitForURL(BASE + "/activity");
    await g.getByTestId("activity-signin").waitFor();
    assert((await g.getByTestId("nav-activity").getAttribute("aria-current")) === "page", "Activity tab: guests are asked to sign in to see their orders and rentals");
    await g.getByTestId("nav-messages").click();
    await g.waitForURL(BASE + "/messages");
    await g.getByTestId("messages-signin").waitFor();
    assert(true, "Messages tab: guests are asked to sign in to get updates");
    // menu: the View cart bar sits above the footer
    await g.goto(BASE + "/menu");
    await g.locator("article", { hasText: "Double espresso over hot water" }).getByRole("button", { name: /^Add/ }).click();
    await g.getByRole("button", { name: /^Add · / }).click();
    const cartBtn = await g.getByRole("button", { name: /View cart/ }).boundingBox();
    const navBox = await nav.boundingBox();
    assert(cartBtn.y + cartBtn.height <= navBox.y + 1, "menu: the View cart bar sits just above the footer, not under it");
    await g.getByRole("button", { name: /View cart/ }).click();
    await g.getByRole("link", { name: "Checkout" }).click();
    await g.waitForURL(BASE + "/checkout");
    await g.waitForTimeout(500);
    assert((await nav.count()) === 0, "no footer on checkout (it has its own Place order bar)");
    await g.goto(BASE + "/login");
    await g.locator("#email").waitFor();
    assert((await nav.count()) === 0, "no footer on staff sign-in / staff screens");

    // ---- signed-in customer: order → inbox messages + unread badge, live
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    await c.goto(BASE + "/");
    await c.getByTestId("bottom-nav").waitFor();
    await c.waitForTimeout(1500);
    assert((await c.getByTestId("unread-badge").count()) === 0, "no unread badge before any updates");

    const cust = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cust.auth.signInWithPassword({ email: `${PHONE}@phone.invalid`, password: PASS });
    const item = sql("select id from menu_items where name = 'Americano'");
    const opts = sql(`select coalesce(string_agg(o.id::text, ','), '') from item_options o join menu_item_option_groups m on m.group_id = o.group_id where m.item_id = '${item}' and o.is_default`).split(",").filter(Boolean);
    const placed = await cust.rpc("place_order", { p_order: { customer_name: "Nina Nav", customer_phone: PHONE, order_type: "pickup", payment_method: "cash" }, p_items: [{ menu_item_id: item, quantity: 1, option_ids: opts }] });
    assert(!placed.error, "customer placed an order " + (placed.error?.message ?? ""));
    const no = placed.data.order_number;
    await c.getByTestId("unread-badge").getByText("1").waitFor({ timeout: 10000 });
    assert(true, "Messages tab shows a red unread badge (1) as soon as the order is received — live, no reload");
    sql(`update orders set status = 'ready' where order_number = '${no}'`);
    await c.getByTestId("unread-badge").getByText("2").waitFor({ timeout: 10000 });
    assert(true, "badge goes to 2 when staff mark the order ready");

    await c.getByTestId("nav-messages").click();
    await c.waitForURL(BASE + "/messages");
    const list = c.getByTestId("messages-list");
    await list.waitFor();
    const titles = await list.getByTestId("message").allInnerTexts();
    assert(titles.length === 2 && titles[0].includes(`Order ${no} · ready`) && titles[0].includes("Come pick it up") && titles[1].includes(`Order ${no} received`), "Messages lists the updates, newest first (ready, then received)");
    assert((await list.locator("[data-unread]").count()) === 2, "new messages are marked with a red dot");
    await c.waitForFunction(() => !document.querySelector("[data-testid=unread-badge]"), null, { timeout: 8000 });
    assert(sql(`select count(*) from customer_messages m join auth.users a on a.id = m.user_id where a.email = '${PHONE}@phone.invalid' and read_at is null`) === "0", "opening Messages marks them read and clears the badge");
    sql(`update orders set status = 'completed' where order_number = '${no}'`);
    await list.getByText(`Order ${no} · completed`).waitFor({ timeout: 10000 });
    assert(true, "a new update appears on the open Messages page live");
    await list.getByTestId("message").first().click();
    await c.waitForURL(/\/order\/[0-9a-f-]{36}/);
    assert((await c.getByTestId("nav-activity").getAttribute("aria-current")) === "page", "tapping a message opens the order; the Activity tab is highlighted on order pages");

    // ---- Activity: the customer's orders
    await c.getByTestId("nav-activity").click();
    await c.waitForURL(BASE + "/activity");
    await c.getByTestId("history-orders").getByText(no).waitFor();
    assert((await c.getByTestId("history").getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join("|") === "Orders (1)|Scooter rentals (0)", "Activity shows Orders / Scooter rentals tabs with the customer's order");
    await c.getByTestId("nav-home").click();
    await c.waitForURL(BASE + "/");
    assert(true, "Home tab returns to the landing page");
    console.log("ALL FOOTER & MESSAGES CHECKS PASSED");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
