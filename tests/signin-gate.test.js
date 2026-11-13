// Customers must have an account to order or book (store_settings.require_account), with "Continue with Google".
// Start the app (npx next start -p 3000) with the local Supabase stack and run: npm run test:signin
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const PHONE = "09175550199";

async function cartAndCheckout(page) {
  await page.goto(BASE + "/menu");
  await page.locator("article", { hasText: "Double espresso over hot water" }).getByRole("button", { name: /^Add/ }).click();
  await page.getByRole("button", { name: /^Add · / }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.waitForURL(BASE + "/checkout");
}

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("update store_settings set require_account = true, is_open = true, open_time = '00:00', close_time = '23:59'");
  sql("update rental_settings set bookings_enabled = true, terms = coalesce(nullif(terms, ''), 'Test terms.')");
  sql("insert into scooters (name, daily_rate, is_active) select 'Gate Scooter', 500, true where not exists (select 1 from scooters where is_active)");
  const browser = await chromium.launch();
  try {
    const guest = await (await browser.newContext(devices["iPhone 13"])).newPage();

    // ---- guest at checkout → sign-in gate, no order form
    await cartAndCheckout(guest);
    await guest.getByTestId("signin-gate").waitFor();
    assert((await guest.locator("#name").count()) === 0, "signed-out customer sees the sign-in step instead of the order form");

    // ---- Continue with Google → Supabase authorize URL for Google, coming back to /auth/callback → /checkout
    let authorize = null;
    await guest.route("**/auth/v1/authorize**", (route) => {
      authorize = route.request().url();
      route.abort();
    });
    await guest.getByTestId("google-signin").click();
    await guest.waitForTimeout(1500);
    assert(authorize && new URL(authorize).searchParams.get("provider") === "google", "Continue with Google goes to Google sign-in");
    const back = new URL(new URL(authorize).searchParams.get("redirect_to"));
    assert(back.pathname === "/auth/callback" && back.searchParams.get("next") === "/checkout", "…and returns to the checkout afterwards");
    await guest.unroute("**/auth/v1/authorize**");

    // ---- the callback page: errors are shown, never a blank page
    await guest.goto(BASE + "/auth/callback?error=access_denied&error_description=The+user+cancelled");
    await guest.getByText("The user cancelled").waitFor();
    assert(true, "a cancelled Google sign-in shows a message and a way back");

    // ---- Create account from the gate → back at checkout with details filled in
    await cartAndCheckout(guest);
    await guest.getByRole("link", { name: "Create account" }).click();
    await guest.locator("#su-name").waitFor();
    assert(guest.url().includes("next=%2Fcheckout"), "Create account remembers the checkout");
    assert((await guest.getByTestId("google-signin").count()) === 1, "the account page offers Continue with Google too");
    await guest.locator("#su-name").fill("Gate Tester");
    await guest.locator("#su-phone").fill(PHONE);
    await guest.locator("#a-pass").fill("Kape-sa-umaga-1");
    await guest.getByRole("button", { name: "Create account" }).click();
    await guest.waitForURL(BASE + "/checkout", { timeout: 15000 });
    await guest.locator("#name").waitFor();
    assert((await guest.locator("#name").inputValue()) === "Gate Tester" && (await guest.locator("#phone").inputValue()) === PHONE, "after creating an account the customer is back at checkout with name and mobile filled in");
    await guest.getByRole("button", { name: /Place order/ }).click();
    await guest.waitForURL(/\/order\/[0-9a-f-]{36}\?new=1/);
    assert(
      sql(`select count(*) from orders o join auth.users a on a.id = o.customer_id where a.email = '${PHONE}@phone.invalid'`) === "1",
      "the order is linked to the customer's account"
    );

    // ---- Baybayin: signed in → details filled; My account lists bookings section
    await guest.goto(BASE + "/baybayin");
    await guest.locator("#renter-name").waitFor();
    assert((await guest.locator("#renter-name").inputValue()) === "Gate Tester", "signed-in renter's name is filled in on the booking form");
    await guest.goto(BASE + "/account");
    const hist = guest.getByTestId("history");
    await hist.waitFor();
    const order = sql(`select o.order_number from orders o join auth.users a on a.id = o.customer_id where a.email = '${PHONE}@phone.invalid'`);
    // a scooter booking for this customer (made directly, so the test doesn't depend on calendar times)
    const bk = sql(`insert into rental_bookings (scooter_id, scooter_name, customer_name, customer_phone, start_date, end_date, days, daily_rate, total, deposit_amount, license_path, pickup_at, return_at, blocked_until, customer_user_id)
      select s.id, s.name, 'Gate Tester', '${PHONE}', current_date + 30, current_date + 31, 1, 500, 500, 250, 'test/license.png', (current_date + 30) + time '09:00', (current_date + 31) + time '09:00', (current_date + 31) + time '09:30', u.id
      from scooters s, auth.users u where s.is_active and u.email = '${PHONE}@phone.invalid' limit 1 returning booking_number`).split("\n")[0];
    await guest.reload();
    await hist.waitFor();
    const boxes = await hist.boundingBox(), page = await guest.evaluate(() => document.body.scrollHeight);
    assert(page - (boxes.y + boxes.height) < 200, "My history sits at the bottom of the account page");
    assert((await hist.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join("|") === "Orders (1)|Scooter rentals (1)", "two tabs: Orders and Scooter rentals, with counts");
    assert((await hist.getByTestId("history-orders").innerText()).includes(order), "Orders tab lists the customer's café order");
    await hist.getByRole("tab", { name: /Scooter rentals/ }).click();
    const rentals = await hist.getByTestId("history-rentals").innerText();
    assert(rentals.includes(bk) && rentals.includes("₱500") && (await hist.getByTestId("history-orders").count()) === 0, "Scooter rentals tab lists the booking (number, scooter, dates, total, status)");
    await guest.reload();
    await hist.getByTestId("history-rentals").waitFor();
    assert(true, "the chosen tab is remembered on this phone");
    await hist.getByRole("link", { name: new RegExp(bk) }).click();
    await guest.waitForURL(/\/baybayin\/booking\//);
    assert(true, "tapping a rental opens its booking page");

    // ---- signed out: Baybayin shows dates & scooters but asks to sign in before details
    const anon = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await anon.goto(BASE + "/baybayin");
    await anon.getByTestId("signin-gate").waitFor();
    assert((await anon.locator("#renter-name").count()) === 0 && (await anon.getByText("Pickup", { exact: false }).count()) > 0, "signed-out visitors can browse dates and scooters, and sign in to book");

    // ---- signing in from the account page with ?next= goes straight back
    await anon.goto(BASE + "/account?next=%2Fcheckout");
    await anon.locator("#a-email").fill(PHONE);
    await anon.locator("#a-pass").fill("Kape-sa-umaga-1");
    await anon.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await anon.waitForURL(BASE + "/checkout", { timeout: 15000 });
    assert(true, "sign in with ?next= returns to where the customer was");

    // ---- an off-site ?next= is ignored
    const off = await (await browser.newContext()).newPage();
    await off.goto(BASE + "/account?next=%2F%2Fexample.com");
    await off.locator("#a-email").fill(PHONE);
    await off.locator("#a-pass").fill("Kape-sa-umaga-1");
    await off.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await off.getByRole("heading", { name: "Hi, Gate!" }).waitFor();
    assert(new URL(off.url()).host === new URL(BASE).host, "a return address on another site is ignored");

    // ---- switch off → guests order again
    sql("update store_settings set require_account = false");
    const guest2 = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await cartAndCheckout(guest2);
    await guest2.locator("#name").waitFor();
    assert((await guest2.getByTestId("signin-gate").count()) === 0, "with the setting off, guests can order without an account");
    console.log("ALL SIGN-IN GATE CHECKS PASSED");
  } finally {
    sql("update store_settings set require_account = false");
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
