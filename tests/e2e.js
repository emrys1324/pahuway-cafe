// End-to-end check of the acceptance criteria (customer phone + staff tablet + rider phone).
// Needs: local Supabase running with migration + seed, `npm run seed:users`, and the app on :3000.
// Run:   npm run test:e2e   (requires the `playwright` package and Chromium)
// Note: the test toggles store open/closed and sold-out flags, and creates an order. Use a dev DB only.
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = require("path").join(__dirname, "../docs/screenshots/");
const RECEIPT = require("path").join(__dirname, "fixtures/gcash-receipt.png");
const log = (...a) => console.log("•", ...a);
const t0 = Date.now();
// guest orders here (the sign-in gate has its own test: npm run test:signin)
require("child_process").execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", "update store_settings set require_account = false, cash_after_orders = 0"]);

(async () => {
  const browser = await chromium.launch();
  // Count chime oscillators so we can prove the audible alert fired
  const chimeCounter = () => {
    window.__chimes = 0;
    const orig = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { window.__chimes++; return orig.apply(this, a); };
  };

  // ---------- Staff on a tablet ----------
  const adminCtx = await browser.newContext({ ...devices["iPad (gen 7) landscape"] });
  await adminCtx.addInitScript(chimeCounter);
  const admin = await adminCtx.newPage();
  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");
  await admin.getByText("Live", { exact: true }).waitFor();
  await admin.click("button:has-text('Tap to turn on order sound')");
  await admin.getByText("🔔 Sound on").waitFor();
  const chimesBefore = await admin.evaluate(() => window.__chimes);
  log("admin signed in, board live, sound on");

  // ---------- Guest on a phone ----------
  const custCtx = await browser.newContext({ ...devices["iPhone 13"] });
  const cust = await custCtx.newPage(); global.cust = cust;
  // home: choose the café or the (coming soon) scooter rental
  await cust.goto(BASE + "/");
  await cust.getByRole("heading", { name: "Welcome!" }).waitFor();
  const scooter = cust.getByTestId("choose-scooter");
  await scooter.getByText("Coming soon").waitFor({ timeout: 10000 }).catch(() => {
    throw new Error("Scooter rental should show Coming soon");
  });
  await cust.getByTestId("choose-cafe").getByText(/Open now · until/).waitFor();
  await cust.screenshot({ path: SHOTS + "0-home.png" });
  await scooter.click();
  await cust.waitForURL(BASE + "/baybayin");
  await cust.getByRole("link", { name: "Back to home" }).click();
  await cust.waitForURL(BASE + "/");
  await cust.getByTestId("choose-cafe").click();
  await cust.waitForURL(BASE + "/menu");
  log("home: café card (open now) → menu; Baybayin card → its Coming soon page and back");
  await cust.getByRole("heading", { name: "Coffee", exact: true }).waitFor();
  await cust.screenshot({ path: SHOTS + "1-menu.png" });
  // sold-out item has no Add button
  const croissant = cust.locator("article", { hasText: "Butter Croissant" });
  if (await croissant.getByRole("button", { name: /Add/ }).count()) throw new Error("Sold-out item shows Add");
  await croissant.getByText("Sold out").waitFor();
  log("sold-out croissant: badge shown, no Add button");

  // customise an iced latte
  await cust.locator("article", { hasText: "Café Latte" }).getByRole("button", { name: "Add Café Latte" }).click();
  await cust.getByLabel("Iced").check();
  await cust.getByRole("button", { name: "50%" }).click();
  await cust.getByLabel("Oat milk").check();
  await cust.getByLabel("Extra shot").check();
  await cust.fill("#item-notes", "less ice please");
  await cust.screenshot({ path: SHOTS + "2-item-options.png" });
  const addBtn = cust.getByRole("button", { name: /^Add · / });
  const addText = await addBtn.textContent();
  if (!addText.includes("240")) throw new Error("Unexpected price: " + addText); // 150+10+40+40
  await cust.getByRole("button", { name: "Increase quantity" }).click();
  await addBtn.click();
  await cust.getByRole("button", { name: /View cart/ }).click();
  await cust.screenshot({ path: SHOTS + "3-cart.png" });
  await cust.getByRole("link", { name: "Checkout" }).click();
  await cust.waitForURL(BASE + "/checkout");
  log("latte customised (₱240 each ×2) → checkout");

  // checkout: validation first
  await cust.getByRole("radio", { name: /Delivery/ }).click();
  await cust.fill("#name", "Maria Santos");
  await cust.fill("#phone", "0917123");
  await cust.getByRole("button", { name: /Place order/ }).click();
  await cust.getByText("Use the format 09XXXXXXXXX").waitFor();
  await cust.getByText("Please choose your barangay.").waitFor();
  log("client validation: phone + barangay errors shown");
  await cust.fill("#phone", "0917 123 4567");
  await cust.selectOption("#zone", { label: "Poblacion — ₱30 delivery" });
  await cust.fill("#street", "Purok 3, Rizal St.");
  await cust.fill("#landmark", "Blue gate beside the chapel");
  await cust.fill("#rider-notes", "Please call when near");
  await cust.getByRole("radio", { name: /GCash/ }).click();
  if (await cust.locator("#gcash-ref").count()) throw new Error("GCash reference field should be gone");
  await cust.setInputFiles("input[type=file]", RECEIPT);
  await cust.getByText("Change screenshot").waitFor();
  await cust.screenshot({ path: SHOTS + "4-checkout.png", fullPage: true });
  const placeBtn = await cust.getByRole("button", { name: /Place order/ }).textContent();
  if (!placeBtn.includes("510")) throw new Error("Total should be ₱510: " + placeBtn);
  await cust.getByRole("button", { name: /Place order/ }).click();
  await cust.waitForURL(/\/order\/[0-9a-f-]{36}\?new=1/);
  const orderUrl = cust.url().split("?")[0];
  const orderNo = (await cust.locator("p.font-display.text-4xl").textContent()).trim();
  await cust.getByText("Live updates").waitFor();
  await cust.getByText("We got your order.").waitFor();
  await cust.screenshot({ path: SHOTS + "5-confirmation.png", fullPage: true });
  log(`order placed: ${orderNo} (₱510), status page live`);

  // ---------- Staff gets it instantly with sound ----------
  const tPlaced = Date.now();
  const card = admin.locator("button.card", { hasText: orderNo });
  await card.waitFor({ timeout: 8000 });
  log(`staff board received ${orderNo} in ${Date.now() - tPlaced} ms (no reload)`);
  await admin.waitForFunction((b) => window.__chimes > b, chimesBefore, { timeout: 5000 });
  log("audible chime played on staff tablet");
  await admin.screenshot({ path: SHOTS + "6-staff-board.png" });

  await card.click();
  await admin.getByAltText("GCash payment screenshot").waitFor();
  await admin.getByText("Check the amount and reference on the screenshot").waitFor();
  await admin.screenshot({ path: SHOTS + "7-staff-order-detail.png" });
  await admin.getByRole("button", { name: "Mark GCash payment verified" }).click();
  await admin.getByText("Paid", { exact: true }).waitFor();
  await cust.getByText("GCash payment verified ✓").waitFor({ timeout: 8000 });
  log("GCash verified by staff → customer page updated live");
  await admin.selectOption("#rider", { label: "Jun Dela Cruz" });
  await admin.getByRole("button", { name: "Accept & prepare" }).click();
  const tAccept = Date.now();
  await cust.getByText("Our baristas are on it.").waitFor({ timeout: 8000 });
  log(`accepted → customer sees "Preparing" in ${Date.now() - tAccept} ms (no reload)`);
  await admin.getByRole("button", { name: "Mark ready" }).click();
  await cust.getByText("Waiting for our rider.").waitFor({ timeout: 8000 });
  log("ready → customer sees Packed");
  await admin.keyboard.press("Escape");

  // ---------- Rider ----------
  const riderCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const rider = await riderCtx.newPage();
  await rider.goto(BASE + "/rider");
  await rider.waitForURL(/\/rider\/login/);
  await rider.fill("#rider-email", "rider@pahuway.cafe");
  await rider.fill("#rider-password", "ChangeMe-Rider-2026");
  await rider.click("button:has-text('Sign in')");
  await rider.waitForURL(BASE + "/rider");
  await rider.getByText(orderNo).waitFor();
  await rider.getByText("Paid via GCash").waitFor();
  await rider.locator(`a[href="tel:09171234567"]`).first().waitFor();
  await rider.screenshot({ path: SHOTS + "8-rider.png", fullPage: true });
  const riderCount = await rider.locator("article").count();
  await rider.getByRole("button", { name: "Picked up" }).click();
  await cust.getByText("Your order is on the way!").waitFor({ timeout: 8000 });
  log(`rider sees ${riderCount} assigned order(s); picked up → customer sees Out for delivery`);
  await rider.getByRole("button", { name: "✓ Delivered" }).click();
  await cust.getByText("Enjoy! Salamat po.").waitFor({ timeout: 8000 });
  await cust.screenshot({ path: SHOTS + "9-delivered.png", fullPage: true });
  log("rider delivered → customer sees Delivered (live)");
  // Admin board moved it to done
  await admin.getByText(/Completed & cancelled today \(1\)/).waitFor({ timeout: 8000 });

  // ---------- Sold-out toggle hides Add immediately ----------
  await cust.goto(BASE + "/menu");
  const americano = cust.locator("article", { hasText: "Americano" });
  await americano.getByRole("button", { name: "Add Americano" }).waitFor();
  await admin.goto(BASE + "/admin/menu");
  await admin.getByRole("switch", { name: "Americano sold out" }).click();
  const tSold = Date.now();
  await americano.getByText("Sold out").waitFor({ timeout: 8000 });
  if (await americano.getByRole("button", { name: "Add Americano" }).count()) throw new Error("Add still visible");
  log(`Americano marked sold out → Add button gone on customer phone in ${Date.now() - tSold} ms`);
  await admin.getByRole("switch", { name: "Americano sold out" }).click();
  await americano.getByRole("button", { name: "Add Americano" }).waitFor({ timeout: 8000 });

  // ---------- Store closed blocks orders ----------
  await americano.getByRole("button", { name: "Add Americano" }).click();
  await cust.getByRole("button", { name: /^Add · / }).click();
  await admin.getByRole("switch", { name: "Store open for orders" }).click();
  await cust.getByText("We're closed right now.").waitFor({ timeout: 8000 });
  if (await cust.getByRole("button", { name: /^\+ Add/ }).count()) throw new Error("Add buttons visible while closed");
  await cust.screenshot({ path: SHOTS + "10-closed.png" });
  await cust.goto(BASE + "/checkout");
  await cust.getByRole("button", { name: "Ordering is closed" }).waitFor();
  log(`store closed → friendly message, Add hidden, checkout button disabled`);
  await admin.getByRole("switch", { name: "Store open for orders" }).click();
  await cust.getByRole("button", { name: /Place order/ }).waitFor({ timeout: 8000 });
  log("store reopened → checkout enabled again");

  // ---------- Summary ----------
  await admin.goto(BASE + "/admin/summary");
  await admin.getByText("Top 5 items").waitFor();
  await admin.getByText("Café Latte").waitFor();
  await admin.screenshot({ path: SHOTS + "11-summary.png" });
  log("daily summary shows sales + top items");

  await browser.close();
  console.log(`\nALL E2E CHECKS PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch(async (e) => {
  console.error("E2E FAILED:", e.message); try { console.error((await global.cust.locator("[role=alert]").allTextContents()).join(" | ")); } catch {}
  process.exit(1);
});
