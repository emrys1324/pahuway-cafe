// Menu item photos: add from the list, replace (with automatic shrinking), remove, and storage clean-up.
// Needs local Supabase (migrations + seed) + seed:users + app on :3000.  Run: npm run test:photos
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const sharp = require("sharp");
const { readFileSync } = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(path.join(__dirname, "../.env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const files = () => sql("select coalesce(string_agg(name || ':' || (metadata->>'size'), ','), '') from storage.objects where bucket_id='menu-photos' and name like 'items/%'");
const fileCount = () => Number(sql("select count(*) from storage.objects where bucket_id='menu-photos' and name like 'items/%'"));
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

(async () => {
  sql("update store_settings set require_account = false, cash_after_orders = 0"); // guest orders/bookings (the sign-in gate has its own test)
  // start clean: remove leftover item photos through the Storage API (direct SQL deletes are blocked)
  const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from("menu-photos");
  const { data: left } = await storage.list("items", { limit: 1000 });
  if (left?.length) await storage.remove(left.map((f) => `items/${f.name}`));
  sql("update menu_items set photo_url = null where name in ('Americano', 'Banana Bread')");
  const browser = await chromium.launch();
  const admin = await (await browser.newContext({ ...devices["iPad (gen 7) landscape"] })).newPage();
  admin.on("dialog", (d) => d.accept());
  const cust = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await cust.goto(BASE + "/menu");
  const custAmericano = cust.locator("article", { hasText: "Double espresso over hot water" });
  await custAmericano.waitFor();

  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");
  await admin.goto(BASE + "/admin/menu");
  await admin.getByRole("button", { name: /^No photo \(\d+\)$/ }).waitFor();
  const before = Number((await admin.getByRole("button", { name: /^No photo/ }).textContent()).match(/\d+/)[0]);
  assert(before === Number(sql("select count(*) from menu_items where photo_url is null")), `"No photo" filter counts items without photos (${before})`);

  // 1. add from the list row — saves immediately
  await admin.setInputFiles("input[aria-label='Add photo for Americano']", path.join(__dirname, "fixtures/test-logo.png"));
  await admin.locator("input[aria-label='Change photo for Americano']").waitFor({ state: "attached", timeout: 15000 });
  const url1 = sql("select photo_url from menu_items where name='Americano'");
  assert(url1.includes("/storage/v1/object/public/menu-photos/items/"), "photo added from the menu list is saved straight away");
  assert((await admin.getByRole("button", { name: /^No photo/ }).textContent()).includes(`(${before - 1})`), "No-photo count goes down by one");
  await custAmericano.locator(`img[src="${url1}"]`).waitFor({ timeout: 8000 });
  assert(true, "customer menu shows the new photo live (no reload)");
  await admin.screenshot({ path: path.join(__dirname, "../docs/screenshots/22-admin-menu-photos.png") });

  // 2. replace with a big camera-size photo → shrunk, old file deleted
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 98 }).toBuffer();
  assert(big.length > 5 * 1024 * 1024, `test photo is bigger than the 5 MB limit (${(big.length / 1048576).toFixed(1)} MB)`);
  await admin.setInputFiles("input[aria-label='Change photo for Americano']", { name: "IMG_1234.jpg", mimeType: "image/jpeg", buffer: big });
  await admin.waitForFunction((u) => !document.querySelector(`img[src="${u}"]`), url1, { timeout: 20000 });
  const url2 = sql("select photo_url from menu_items where name='Americano'");
  const stored = files().split(",");
  assert(url2 !== url1 && url2.endsWith(".jpg"), "big phone photo uploaded and saved");
  assert(stored.length === 1, "the replaced photo's old file was deleted (1 file in storage)");
  const size = Number(stored[0].split(":")[1]);
  assert(size < 1.5 * 1024 * 1024, `photo shrunk before upload: ${(big.length / 1048576).toFixed(1)} MB → ${(size / 1048576).toFixed(2)} MB`);
  await custAmericano.locator(`img[src="${url2}"]`).waitFor({ timeout: 8000 }); // wait for the live update
  const dims = await custAmericano.locator("img").evaluate(async (img) => { await img.decode().catch(() => {}); return [img.naturalWidth, img.naturalHeight]; });
  assert(Math.max(...dims) === 1400, `resized to max 1400px (${dims.join("×")}), aspect ratio kept`);

  // 3. remove in the editor
  await admin.getByRole("button", { name: /^Americano/ }).click();
  await admin.getByRole("button", { name: "Remove photo" }).click();
  await admin.getByRole("button", { name: "Save" }).click();
  await admin.getByRole("dialog").waitFor({ state: "detached" });
  assert(sql("select coalesce(photo_url, 'null') from menu_items where name='Americano'") === "null", "Remove photo + Save clears the item's photo");
  assert(fileCount() === 0, "removed photo's file deleted from storage");
  await custAmericano.locator("img").waitFor({ state: "detached", timeout: 8000 });
  assert(true, "customer menu falls back to the placeholder live");

  // 4. upload in the editor, then close without saving → nothing left behind
  await admin.getByRole("button", { name: /^Americano/ }).click();
  await admin.setInputFiles("[role=dialog] input[type=file]", path.join(__dirname, "fixtures/test-logo.png"));
  await admin.getByRole("dialog").getByText("Change photo", { exact: true }).waitFor();
  assert(fileCount() === 1, "editor upload stored (pending save)");
  await admin.keyboard.press("Escape");
  await admin.getByRole("dialog").waitFor({ state: "detached" });
  await admin.waitForTimeout(800);
  assert(fileCount() === 0 && sql("select coalesce(photo_url, 'null') from menu_items where name='Americano'") === "null", "closing without saving discards the upload");

  // 5. deleting an item deletes its photo
  await admin.setInputFiles("input[aria-label='Add photo for Banana Bread']", path.join(__dirname, "fixtures/test-logo.png"));
  await admin.locator("input[aria-label='Change photo for Banana Bread']").waitFor({ state: "attached", timeout: 15000 });
  assert(fileCount() === 1, "photo added to Banana Bread");
  await admin.getByRole("button", { name: /^Banana Bread/ }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "detached" });
  await admin.waitForTimeout(500);
  assert(fileCount() === 0, "deleting the item deleted its photo file");

  await browser.close();
  console.log("\nALL PHOTO TESTS PASSED");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
