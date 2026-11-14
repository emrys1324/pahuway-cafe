// End-to-end online payment flow with a mock HitPay.
// Start the app with:  HITPAY_API_KEY=hp_e2e HITPAY_SALT=salt_e2e HITPAY_API_BASE=http://127.0.0.1:4010 npx next start -p 3000
// Then run:            npm run test:payments:e2e   (local Supabase + seed:users)
const { chromium, devices } = require("playwright");
const path = require("path");
const { startMockHitpay } = require("./mock-hitpay");
const RECEIPT = require("path").join(__dirname, "fixtures/gcash-receipt.png");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = path.join(__dirname, "../docs/screenshots/");
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

(async () => {
  require("child_process").execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", "update store_settings set require_account = false, cash_after_orders = 0"]); // guest orders/bookings (the sign-in gate has its own test)
  const mock = await startMockHitpay({ port: 4010, salt: "salt_e2e", apiKey: "hp_e2e" });
  const browser = await chromium.launch();
  const adminCtx = await browser.newContext({ ...devices["iPad (gen 7) landscape"] });
  await adminCtx.addInitScript(() => {
    window.__chimes = 0;
    const o = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { window.__chimes++; return o.apply(this, a); };
  });
  const admin = await adminCtx.newPage();
  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");

  // 1. enable online payments
  await admin.goto(BASE + "/admin/settings");
  await admin.getByText("Test mode:").waitFor();
  const onlineSwitch = admin.getByRole("switch", { name: "Accept online payments" });
  await admin.waitForTimeout(500); // let the saved settings load before toggling
  if ((await onlineSwitch.getAttribute("aria-checked")) !== "true") await onlineSwitch.click();
  await admin.waitForFunction(() => document.querySelector("[role=switch][aria-label='Accept online payments'], [role=switch]")?.getAttribute("aria-checked") !== null);
  if ((await onlineSwitch.getAttribute("aria-checked")) !== "true") throw new Error("online payments switch did not turn on");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  const { execFileSync } = require("child_process");
  const saved = execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", "select online_payments_enabled from store_settings"]).toString().trim();
  assert(saved === "t", "admin turned on online payments (test-mode notice shown, saved)");

  await admin.goto(BASE + "/admin");
  await admin.getByText("Live", { exact: true }).waitFor();
  await admin.click("button:has-text('Tap to turn on order sound')");
  const chimes0 = await admin.evaluate(() => window.__chimes);

  // 2. customer pays online
  const cust = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await cust.goto(BASE + "/menu");
  await cust.locator("article", { hasText: "Café Latte" }).getByRole("button", { name: "Add Café Latte" }).click();
  await cust.getByLabel("Iced").check();
  await cust.getByRole("button", { name: /^Add · / }).click();
  await cust.getByRole("button", { name: /View cart/ }).click();
  await cust.getByRole("link", { name: "Checkout" }).click();
  await cust.getByRole("radio", { name: /Pickup/ }).click(); // Delivery is the default now
  await cust.fill("#name", "Lea Online");
  await cust.fill("#phone", "09171230000");
  await cust.getByRole("radio", { name: /Pay online/ }).click();
  await cust.getByTestId("online-pay-info").waitFor();
  await cust.screenshot({ path: SHOTS + "18-checkout-pay-online.png", fullPage: true });
  await cust.getByRole("button", { name: /Continue to payment · ₱160/ }).click();
  await cust.waitForURL(/127\.0\.0\.1:4010\/checkout\/pr_1/);
  assert((await cust.locator("#amount").textContent()) === "PHP 160.00" && (await cust.locator("#methods").textContent()) === "all-enabled", "redirected to HitPay checkout for ₱160 with the account's payment methods");
  const orderNo = await cust.locator("#ref").textContent();

  await admin.waitForTimeout(3000);
  assert((await admin.locator("button.card", { hasText: orderNo }).count()) === 0, "unpaid online order is NOT on the staff board");
  assert((await admin.evaluate(() => window.__chimes)) === chimes0, "no chime before payment");

  await cust.getByRole("button", { name: "Pay with GCash" }).click();
  await cust.waitForURL(/\/order\/[0-9a-f-]{36}\?new=1&paid=1&reference=pr_1&status=completed/);
  await cust.getByText("Paid online ✓").waitFor({ timeout: 10000 });
  await cust.getByText("We got your order.").waitFor();
  await cust.screenshot({ path: SHOTS + "19-paid-online.png", fullPage: true });
  assert(true, "customer returns to the status page: Paid online ✓ and order received");

  const card = admin.locator("button.card", { hasText: orderNo });
  await card.waitFor({ timeout: 8000 });
  await admin.waitForFunction((n) => window.__chimes > n, chimes0, { timeout: 5000 });
  assert((await card.textContent()).includes("Paid online ✓"), "order appears on the board when paid, with chime and 'Paid online' badge");
  await admin.screenshot({ path: SHOTS + "20-board-paid-online.png" });

  // 3. staff reject → refund
  await card.click();
  await admin.getByText("Online · HitPay").waitFor();
  await admin.getByRole("button", { name: "Reject" }).click();
  await admin.getByRole("button", { name: "Item not available" }).click();
  await admin.getByRole("button", { name: "Confirm" }).click();
  const refundBtn = admin.getByRole("button", { name: /Refund ₱160 to customer/ });
  await refundBtn.waitFor({ timeout: 8000 });
  assert(true, "after rejecting a paid online order, the refund button appears");
  admin.once("dialog", (d) => d.accept());
  await refundBtn.click();
  await admin.getByText(/^Refunded/).first().waitFor({ timeout: 8000 });
  assert(mock.refunds.length === 1 && mock.refunds[0].amount === "160.00" && mock.refunds[0].payment_id === "pay_pr_1", "full ₱160 refund sent to HitPay for the right payment");
  await cust.getByText("Your online payment has been refunded.").waitFor({ timeout: 8000 });
  assert(true, "customer sees the cancellation and refund live");
  await admin.keyboard.press("Escape");

  // 4. abandoned checkout → resume later with the same session
  await cust.goto(BASE + "/menu");
  await cust.locator("article", { hasText: "Ensaymada" }).getByRole("button", { name: "Add Ensaymada" }).click();
  await cust.getByRole("button", { name: /^Add · / }).click();
  await cust.getByRole("button", { name: /View cart/ }).click();
  await cust.getByRole("link", { name: "Checkout" }).click();
  await cust.getByRole("radio", { name: /Pickup/ }).click();
  await cust.getByRole("radio", { name: /Pay online/ }).click();
  await cust.getByRole("button", { name: /Continue to payment/ }).click();
  await cust.waitForURL(/checkout\/pr_2/);
  const pendingOrderUrl = BASE + new URL(mock.requests.get("pr_2").redirect_url).pathname + "?new=1";
  await cust.goto(pendingOrderUrl); // customer leaves HitPay without paying

  await cust.getByText("Complete your payment").waitFor();
  assert(/Time left to pay: (29|30):/.test(await cust.getByTestId("online-payment-card").textContent()), "abandoned checkout shows 'Complete your payment' with a 30-minute countdown");
  await cust.screenshot({ path: SHOTS + "21-complete-payment.png", fullPage: true });
  await cust.getByRole("button", { name: /Pay now/ }).click();
  await cust.waitForURL(/checkout\/pr_2/);
  assert(mock.requests.size === 2, "Pay now resumes the same HitPay payment request (no duplicate)");

  // 4b. webhook never arrives → the return-check still confirms the payment
  mock.opts.webhooks = false;
  await cust.getByRole("button", { name: "Pay with GCash" }).click();
  await cust.waitForURL(/paid=1/);
  await cust.getByText("Paid online ✓").waitFor({ timeout: 15000 });
  assert(true, "with no webhook at all, the return-check confirms the payment with HitPay");
  const card2 = admin.locator("button.card", { hasText: mock.requests.get("pr_2").reference_number });
  await admin.goto(BASE + "/admin");
  await card2.waitFor({ timeout: 8000 });
  assert(true, "that order reaches the staff board");
  mock.opts.webhooks = true;

  // 4c. can't pay online → switch to manual GCash (screenshot), staff verify it
  const sqlq = (q) => require("child_process").execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
  const abandon = async (prId) => {
    await cust.goto(BASE + "/menu");
    await cust.locator("article", { hasText: "Ensaymada" }).getByRole("button", { name: "Add Ensaymada" }).click();
    await cust.getByRole("button", { name: /^Add · / }).click();
    await cust.getByRole("button", { name: /View cart/ }).click();
    await cust.getByRole("link", { name: "Checkout" }).click();
    await cust.getByRole("radio", { name: /Pickup/ }).click();
    await cust.getByRole("radio", { name: /Pay online/ }).click();
    await cust.getByRole("button", { name: /Continue to payment/ }).click();
    await cust.waitForURL(new RegExp(`checkout/${prId}`));
    await cust.goto(BASE + new URL(mock.requests.get(prId).redirect_url).pathname);
    await cust.getByText("Complete your payment").waitFor();
    return mock.requests.get(prId).reference_number;
  };
  const no3 = await abandon("pr_3");
  await cust.getByTestId("gcash-fallback-open").click();
  const fb = cust.getByTestId("gcash-fallback");
  assert((await fb.getByTestId("gcash-fallback-amount").textContent()).startsWith("₱"), "Can't pay online? opens the GCash details with the exact amount");
  await fb.getByRole("button", { name: "Send GCash screenshot" }).click();
  await fb.getByText("Please attach a screenshot of your GCash payment.").waitFor();
  await cust.setInputFiles("input[aria-label='GCash payment screenshot']", RECEIPT);
  await fb.getByRole("button", { name: "Send GCash screenshot" }).click();
  await cust.getByText("GCash · Verifying").waitFor({ timeout: 10000 });
  assert((await cust.getByTestId("online-payment-card").count()) === 0, "after sending the screenshot the order switches to GCash (Verifying); the online payment card is gone");
  assert(sqlq(`select payment_method||'|'||payment_status||'|'||(payment_proof_path like 'proofs/%')||'|'||(payment_expires_at is null) from orders where order_number='${no3}'`) === "gcash|for_verification|true|true", "saved as a GCash payment to verify, with the screenshot; no 30-minute expiry any more");
  await admin.goto(BASE + "/admin");
  const card3 = admin.locator("button.card", { hasText: no3 });
  await card3.waitFor({ timeout: 8000 });
  assert((await card3.textContent()).includes("GCash"), "the switched order appears on the staff board as GCash to verify");

  // 4d. paid online after all (webhook missed) → switching just confirms the online payment
  mock.opts.webhooks = false;
  const no4 = await abandon("pr_4");
  await cust.request.post(`http://127.0.0.1:4010/checkout/pr_4/pay`, { maxRedirects: 0 }).catch(() => null);
  // the page may notice the payment by itself first and drop the GCash option; either way it must end "Paid online"
  if (await cust.getByTestId("gcash-fallback-open").click({ timeout: 5000 }).then(() => true, () => false)) {
    await cust.setInputFiles("input[aria-label='GCash payment screenshot']", RECEIPT).catch(() => null);
    await cust.getByTestId("gcash-fallback").getByRole("button", { name: "Send GCash screenshot" }).click({ timeout: 5000 }).catch(() => null);
  }
  await cust.getByText("Paid online ✓").waitFor({ timeout: 10000 });
  assert(sqlq(`select payment_method||'|'||payment_status from orders where order_number='${no4}'`) === "online|paid", "if HitPay shows it was paid, the order is confirmed as paid online instead (no double payment)");
  mock.opts.webhooks = true;

  // 5. switch off → option disappears
  await admin.goto(BASE + "/admin/settings");
  await admin.getByRole("switch", { name: "Accept online payments" }).click();
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await cust.goto(BASE + "/checkout");
  await cust.getByRole("radio", { name: /Cash on pickup/ }).waitFor().catch(() => {});
  await cust.goto(BASE + "/menu");
  await cust.locator("article", { hasText: "Ensaymada" }).getByRole("button", { name: "Add Ensaymada" }).click();
  await cust.getByRole("button", { name: /^Add · / }).click();
  await cust.getByRole("button", { name: /View cart/ }).click();
  await cust.getByRole("link", { name: "Checkout" }).click();
  await cust.getByRole("radio", { name: /Cash on/ }).waitFor();
  assert((await cust.getByRole("radio", { name: /Pay online/ }).count()) === 0, "with online payments off, the option is hidden");

  await browser.close();
  mock.server.close();
  console.log("\nALL ONLINE PAYMENT E2E CHECKS PASSED");
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
