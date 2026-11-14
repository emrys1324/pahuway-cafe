// Admin changes the logo and background; customers see it live; staff screens stay plain.
// Needs local Supabase (migrations applied) + seed:users + app on :3000.
// Run: node tests/branding.test.js
const { chromium, devices } = require("playwright");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const F = (n) => path.join(__dirname, "fixtures", n);
const sqlBay = () =>
  require("child_process").execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", "select coalesce(baybayin_logo_url, '') from store_settings"]).toString().trim();
const SHOTS = path.join(__dirname, "../docs/screenshots/");
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

(async () => {
  require("child_process").execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", "update store_settings set require_account = false, cash_after_orders = 0"]); // guest orders/bookings (the sign-in gate has its own test)
  require("child_process").execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", "update rental_settings set bookings_enabled = false"]); // this test checks the Coming soon page
  const browser = await chromium.launch();
  const admin = await (await browser.newContext({ ...devices["iPad (gen 7) landscape"] })).newPage();
  const cust = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();

  // customer has the menu open before any change
  await cust.goto(BASE + "/menu");
  await cust.getByRole("heading", { name: "Coffee", exact: true }).waitFor();
  assert((await cust.locator("header img").first().getAttribute("src")) === "/logo.svg", "default logo shown initially");
  assert((await cust.getByTestId("brand-background").count()) === 0, "no background initially");

  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");
  await admin.goto(BASE + "/admin/settings");
  await admin.getByRole("heading", { name: "Branding" }).waitFor();
  assert((await admin.getByRole("tab", { name: "Welcome page" }).getAttribute("aria-selected")) === "true", "Branding opens on the Welcome page tab");
  await admin.getByRole("tab", { name: "Pahuway Cafe" }).click();

  // validation: tiny logo refused
  await admin.setInputFiles("input[aria-label='Upload logo']", F("test-logo-small.png"));
  await admin.getByText("Logo is too small").waitFor();
  assert(true, "too-small logo rejected with a friendly message");

  // upload logo + background, set fade, save
  await admin.setInputFiles("input[aria-label='Upload logo']", F("test-logo.png"));
  await admin.getByText("Logo uploaded").waitFor();
  const logoSrc = await admin.getByTestId("logo-preview").getAttribute("src");
  assert(logoSrc.includes("/storage/v1/object/public/menu-photos/branding/"), "logo stored in public branding folder");
  await admin.setInputFiles("input[aria-label='Upload background']", F("test-background.png"));
  await admin.getByText("Background uploaded").waitFor();
  await admin.locator("#fade").fill("70");
  await admin.getByTestId("background-preview").scrollIntoViewIfNeeded();
  await admin.screenshot({ path: SHOTS + "13-admin-branding.png" });
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await admin.waitForFunction((src) => document.querySelector("header img")?.getAttribute("src") === src, logoSrc, { timeout: 5000 });
  assert(true, "staff header shows the new logo after saving");

  // customer page updates live (no reload)
  await cust.waitForFunction((src) => document.querySelector("header img")?.getAttribute("src") === src, logoSrc, { timeout: 8000 });
  assert(true, "customer header logo changed live without reload");
  await cust.getByTestId("brand-background").waitFor({ timeout: 8000 });
  const overlay = await cust.getByTestId("brand-background").locator("div").evaluate((el) => getComputedStyle(el).opacity);
  assert(Math.abs(Number(overlay) - 0.7) < 0.01, "background appears live with the chosen 70% fade");
  await cust.screenshot({ path: SHOTS + "14-menu-with-branding.png" });

  // reload persists; staff screens stay plain
  await cust.reload();
  await cust.getByTestId("brand-background").waitFor();
  assert(true, "branding persists after reload");
  assert((await admin.getByTestId("brand-background").count()) === 0, "no background on staff screens");
  await cust.goto(BASE + "/login");
  await cust.locator("img").first().waitFor();
  assert((await cust.getByTestId("brand-background").count()) === 0 && (await cust.locator("main img").first().getAttribute("src")) === logoSrc, "login page: new logo, no background");

  // ---- headers: titles + colours, readable text chosen automatically
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  await admin.locator("#header-color").fill("#808080");
  await admin.getByText("This colour makes header text hard to read").first().waitFor();
  assert(true, "low-contrast header colour shows a readability warning");
  await admin.locator("#header-color").fill("#1e3a5f");
  await admin.locator("#store-name").fill("Isla Café");
  await admin.locator("#staff-title").fill("Kusina Team");
  await admin.getByRole("button", { name: "Use colour #fbf7f0" }).nth(1).click(); // light staff header
  assert((await admin.getByTestId("staff-header-preview").textContent()).includes("Kusina Team"), "staff header preview shows the new title");
  await admin.getByTestId("customer-header-preview").scrollIntoViewIfNeeded();
  await admin.screenshot({ path: SHOTS + "15-admin-header-settings.png" });
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();

  const staffHeader = admin.getByTestId("staff-header");
  await admin.waitForFunction(() => document.querySelector("[data-testid=staff-title]")?.textContent?.trim() === "Kusina Team", null, { timeout: 5000 });
  const sBg = await staffHeader.evaluate((el) => getComputedStyle(el).backgroundColor);
  const sFg = await admin.getByTestId("staff-title").evaluate((el) => getComputedStyle(el).color);
  assert(sBg === "rgb(251, 247, 240)", "staff header uses the chosen light colour");
  assert(ratio(sBg, sFg) >= 4.5, `staff title switched to dark text (contrast ${ratio(sBg, sFg).toFixed(1)}:1)`);
  const tabFg = await admin.getByRole("link", { name: "Menu" }).evaluate((el) => getComputedStyle(el).color);
  assert(ratio(sBg, tabFg) >= 4.5, `staff nav links readable on light header (${ratio(sBg, tabFg).toFixed(1)}:1)`);
  await admin.screenshot({ path: SHOTS + "16-staff-header-custom.png" });

  await cust.goto(BASE + "/menu");
  await cust.waitForFunction(() => document.querySelector("[data-testid=store-title]")?.textContent?.trim() === "Isla Café", null, { timeout: 8000 });
  await cust.waitForTimeout(400); // let the buttons' 150 ms colour transition finish
  const cBg = await cust.getByTestId("customer-header").evaluate((el) => getComputedStyle(el).backgroundColor);
  const cFg = await cust.getByTestId("store-title").evaluate((el) => getComputedStyle(el).color);
  const iconFg = await cust.getByRole("link", { name: "My account" }).evaluate((el) => getComputedStyle(el).color);
  assert(cBg === "rgb(30, 58, 95)", "customer header uses the chosen colour");
  assert(ratio(cBg, cFg) >= 4.5 && ratio(cBg, iconFg) >= 4.5, `customer title + icon switched to light text (contrast ${ratio(cBg, cFg).toFixed(1)}:1)`);
  await cust.screenshot({ path: SHOTS + "17-customer-header-custom.png" });

  // live update on an already-open page (no reload)
  await admin.locator("#store-name").fill("Isla Café Live");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await cust.waitForFunction(() => document.querySelector("[data-testid=store-title]")?.textContent?.trim() === "Isla Café Live", null, { timeout: 8000 });
  assert(true, "store name changes live on an open customer page");

  // ---- Baybayin: own header (name, colour, logo) on its Coming soon page + home card
  await cust.goto(BASE + "/");
  await cust.getByTestId("choose-scooter").waitFor();
  assert((await cust.getByTestId("baybayin-logo").count()) === 0, "home: scooter card shows 🛵 until a Baybayin logo is uploaded");
  await admin.getByRole("tab", { name: "Baybayin" }).click();
  await admin.setInputFiles("input[aria-label='Upload Baybayin logo']", F("test-logo-small.png"));
  await admin.getByText("Logo is too small").waitFor();
  await admin.setInputFiles("input[aria-label='Upload Baybayin logo']", F("test-logo.png"));
  await admin.getByText("Baybayin logo uploaded — press Save settings").waitFor();
  const bayUrl = await admin.getByTestId("baybayin-logo-preview").getAttribute("src");
  assert(bayUrl.includes("/storage/v1/object/public/menu-photos/branding/"), "Baybayin logo uploads to storage with a preview");
  await admin.locator("#baybayin-name").fill("Baybayin Rides");
  await admin.locator("#baybayin-tagline").fill("Scooters by the beach");
  await admin.getByRole("group", { name: "Baybayin header colour" }).getByRole("button", { name: "Use colour #1e3a5f" }).click();
  assert((await admin.getByTestId("baybayin-header-preview").textContent()).includes("Baybayin Rides"), "Baybayin header preview follows the edits");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await cust.waitForFunction((u) => document.querySelector("[data-testid=baybayin-logo]")?.getAttribute("src") === u, bayUrl, { timeout: 8000 });
  assert(true, "home page scooter card shows the Baybayin logo (live, no reload)");
  await cust.getByTestId("choose-scooter").click();
  await cust.waitForURL(BASE + "/baybayin");
  await cust.getByText("Coming soon").first().waitFor();
  const bHeaderBg = await cust.getByTestId("customer-header").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert((await cust.getByTestId("store-title").textContent()).trim() === "Baybayin Rides" && bHeaderBg === "rgb(30, 58, 95)", "Baybayin card opens its Coming soon page with Baybayin's own header (name + colour)");
  assert((await cust.getByTestId("brand-logo").getAttribute("src")) === bayUrl && (await cust.getByTestId("customer-header").getByText(/^(Open|Closed)/).count()) === 0, "…its own logo, and no café open/closed badge");
  await cust.getByRole("link", { name: /Order from .* meanwhile/ }).waitFor();

  // ---- Welcome page: its own header, welcome text, card texts, website icon
  await admin.getByRole("tab", { name: "Welcome page" }).click();
  await admin.locator("#site-name").fill("San Agustin Hub");
  await admin.locator("#site-tagline").fill("Coffee & scooters");
  await admin.getByRole("group", { name: "Welcome page header colour" }).getByRole("button", { name: "Use colour #556c4d" }).click();
  await admin.locator("#welcome-title-input").fill("Mabuhay!");
  await admin.locator("#welcome-subtitle-input").fill("Kape or scooter today?");
  await admin.locator("#cafe-card-text").fill("Best coffee in town");
  await admin.locator("#baybayin-card-text").fill("Island rides, launching soon");
  await admin.setInputFiles("input[aria-label='Upload website icon']", F("test-logo-small.png"));
  await admin.getByText("Icon is too small").waitFor();
  await admin.setInputFiles("input[aria-label='Upload website icon']", F("test-logo.png"));
  await admin.getByText("Website icon ready").waitFor();
  const icon32 = await admin.getByTestId("site-icon-32").getAttribute("src");
  const icon180 = await admin.getByTestId("site-icon-180").getAttribute("src");
  assert(/icon-.*-32\.png$/.test(icon32) && /icon-.*-180\.png$/.test(icon180), "website icon is resized into tab (32) and home-screen (180) sizes");
  const sizes = await admin.evaluate(async (urls) => Promise.all(urls.map(async (u) => { const b = await createImageBitmap(await (await fetch(u)).blob()); return `${b.width}x${b.height}`; })), [icon32, icon180]);
  assert(sizes.join(",") === "32x32,180x180", `icon files have the exact sizes (${sizes.join(", ")})`);
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await cust.goto(BASE + "/");
  await cust.getByTestId("welcome-title").getByText("Mabuhay!").waitFor();
  const homeBg = await cust.getByTestId("customer-header").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert((await cust.getByTestId("store-title").textContent()).trim() === "San Agustin Hub" && homeBg === "rgb(85, 108, 77)", "home page has its own header title and colour");
  assert((await cust.getByTestId("welcome-subtitle").textContent()) === "Kape or scooter today?" && (await cust.getByTestId("choose-cafe").getByText("Best coffee in town").count()) === 1 && (await cust.getByTestId("choose-scooter").getByText("Island rides, launching soon").count()) === 1, "welcome text and both card descriptions are editable");
  assert((await cust.getByTestId("customer-header").getByText(/^(Open|Closed)/).count()) === 0, "home header has no café open badge (it's on the café card)");
  await cust.goto(BASE + "/menu");
  await cust.getByRole("heading", { name: "Coffee", exact: true }).waitFor();
  assert((await cust.getByTestId("store-title").textContent()).trim() === "Isla Café Live", "café pages keep the café's own header (separate branding)");
  // the server caches the icon for up to a minute before the page <head> and manifest pick it up
  let headOk = false;
  for (let i = 0; i < 40 && !headOk; i++) {
    const html = await (await fetch(BASE + "/")).text();
    headOk = html.includes(icon32) && html.includes(icon180);
    if (!headOk) await new Promise((r) => setTimeout(r, 2500));
  }
  assert(headOk, "page <head> uses the uploaded icon (browser tab + Apple home screen)");
  let manifestOk = false;
  for (let i = 0; i < 40 && !manifestOk; i++) {
    const m = await (await fetch(BASE + "/manifest.webmanifest")).json();
    manifestOk = m.icons.some((x) => x.sizes === "192x192" && /icon-.*-192\.png$/.test(x.src)) && m.icons.some((x) => x.sizes === "512x512" && /icon-.*-512\.png$/.test(x.src));
    if (!manifestOk) await new Promise((r) => setTimeout(r, 2500));
  }
  assert(manifestOk, "web-app manifest lists the uploaded icon (192 + 512)");

  // ---- Account ("Welcome back") page: own header, icon and heading
  await cust.goto(BASE + "/account");
  await cust.getByRole("heading", { name: "Welcome back" }).waitFor();
  await admin.getByRole("tab", { name: "Account page" }).click();
  await admin.setInputFiles("input[aria-label='Upload account page icon']", F("test-logo.png"));
  await admin.getByText("Account page icon uploaded — press Save settings").waitFor();
  const acctUrl = await admin.getByTestId("account-logo-preview").getAttribute("src");
  await admin.locator("#account-name").fill("Pahuway Members");
  await admin.locator("#account-tagline").fill("Your orders, saved");
  await admin.getByRole("group", { name: "Account page header colour" }).getByRole("button", { name: "Use colour #1e3a5f" }).click();
  await admin.locator("#account-title-input").fill("Mabuhay, suki!");
  await admin.locator("#account-subtitle-input").fill("Sign in to see your past orders.");
  assert((await admin.getByTestId("account-header-preview").textContent()).includes("Pahuway Members"), "account page header preview follows the edits");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await cust.goto(BASE + "/account");
  await cust.getByRole("heading", { name: "Mabuhay, suki!" }).waitFor();
  const aBg = await cust.getByTestId("customer-header").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(
    (await cust.getByTestId("store-title").textContent()).trim() === "Pahuway Members" && (await cust.getByTestId("brand-logo").getAttribute("src")) === acctUrl && aBg === "rgb(30, 58, 95)" && (await cust.getByText("Sign in to see your past orders.").count()) === 1,
    "account page shows its own header title, icon, colour and sign-in heading",
  );
  await cust.goto(BASE + "/menu");
  await cust.getByRole("heading", { name: "Coffee", exact: true }).waitFor();
  assert((await cust.getByTestId("store-title").textContent()).trim() !== "Pahuway Members", "the café pages keep the café header");
  for (const id of ["#account-name", "#account-tagline", "#account-title-input", "#account-subtitle-input"]) await admin.locator(id).fill("");
  await admin.getByRole("button", { name: "Account page header colour: use default" }).click();
  await admin.getByRole("button", { name: "Use the café logo" }).click();
  await admin.getByRole("tab", { name: "Welcome page" }).click();

  // reset the welcome page + Baybayin branding
  for (const id of ["#site-name", "#site-tagline", "#welcome-title-input", "#welcome-subtitle-input", "#cafe-card-text", "#baybayin-card-text"]) await admin.locator(id).fill("");
  await admin.getByRole("button", { name: "Welcome page header colour: use default" }).click();
  await admin.getByRole("button", { name: "Use default icon" }).click();
  await admin.getByRole("tab", { name: "Baybayin" }).click();
  await admin.locator("#baybayin-name").fill("");
  await admin.locator("#baybayin-tagline").fill("");
  await admin.getByRole("button", { name: "Baybayin header colour: use default" }).click();
  await admin.getByRole("button", { name: "Remove", exact: true }).click();
  await admin.getByRole("tab", { name: "Pahuway Cafe" }).click();

  // revert to defaults
  await admin.locator("#store-name").fill("Pahuway Cafe");
  await admin.locator("#staff-title").fill("Pahuway Staff");
  await admin.getByRole("button", { name: "Header colour: use default", exact: true }).click();
  await admin.getByRole("button", { name: "Staff header colour: use default" }).click();
  await admin.getByRole("button", { name: "Use default logo" }).click();
  await admin.getByRole("button", { name: "Remove background" }).click();
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await cust.goto(BASE + "/menu");
  await cust.getByRole("heading", { name: "Coffee", exact: true }).waitFor();
  assert((await cust.locator("header img").first().getAttribute("src")) === "/logo.svg" && (await cust.getByTestId("brand-background").count()) === 0, "defaults restored");
  assert((await cust.getByTestId("store-title").textContent()).trim() === "Pahuway Cafe", "store name restored");
  assert(sqlBay() === "", "Baybayin logo removed (scooter card back to 🛵)");
  await cust.goto(BASE + "/");
  await cust.getByTestId("welcome-title").getByText("Welcome!").waitFor();
  assert((await cust.getByTestId("store-title").textContent()).trim() === "Pahuway Cafe" && (await cust.getByTestId("choose-scooter").getByText("Scooter rentals for getting around San Agustin. Check back soon!").count()) === 1 && (await cust.getByTestId("baybayin-logo").count()) === 0, "welcome page + Baybayin back to defaults (empty fields = defaults)");
  const restoredBg = await cust.getByTestId("customer-header").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(restoredBg.startsWith("rgba(251, 247, 240"), "customer header back to default cream");

  await browser.close();
  console.log("\nALL BRANDING TESTS PASSED");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
