// Home-screen install ("Padaya"): manifest, iPhone meta tags, service worker + offline page, install prompt.
// Run against a production build (npx next start -p 3000): npm run test:pwa
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

(async () => {
  const browser = await chromium.launch();

  // ---- manifest + head tags
  const m = await (await fetch(BASE + "/manifest.webmanifest")).json();
  assert(m.name.startsWith("Padaya") && m.short_name === "Padaya" && m.display === "standalone" && m.start_url === "/", `manifest: "${m.short_name}", standalone, opens at home`);
  assert(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"), "manifest has 192 and 512 px icons (needed to install)");
  const ctx = await browser.newContext(devices["Pixel 7"]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.getByTestId("home-collage").waitFor();
  const head = await page.evaluate(() => ({
    manifest: !!document.querySelector('link[rel="manifest"]'),
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
    capable: !!document.querySelector('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]'),
    touchIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
  }));
  assert(head.manifest && head.appleTitle === "Padaya" && head.capable && head.touchIcon, "page links the manifest and has iPhone home-screen tags (title Padaya, icon, full screen)");

  // ---- service worker + offline page
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert(scope === BASE + "/", "service worker is registered for the whole site");
  await page.reload();
  await page.evaluate(async () => {
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
  });
  await ctx.setOffline(true);
  await page.goto(BASE + "/menu").catch(() => null);
  await page.getByText("You're offline").waitFor({ timeout: 5000 });
  assert((await page.textContent("body")).includes("Padaya needs an internet connection"), "offline: a friendly Padaya offline page instead of the browser error");
  await ctx.setOffline(false);
  await page.goto(BASE + "/menu");
  await page.getByRole("heading", { name: "Coffee", exact: true }).waitFor();
  assert(true, "back online: pages load live (nothing stale is cached)");

  // ---- install button (Android/desktop Chrome)
  await page.goto(BASE + "/");
  await page.getByTestId("home-collage").waitFor();
  assert((await page.getByTestId("install-prompt").count()) === 0, "no install card until the browser says the app can be installed");
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await page.getByTestId("install-prompt").getByRole("button", { name: "Install" }).click();
  await page.getByText("Padaya is on your home screen ✓").waitFor();
  assert(await page.evaluate(() => window.__prompted), "Install button opens the browser's install dialog; after accepting it says it's on the home screen");

  // ---- iPhone Safari: Share → Add to Home Screen steps; "Not now" remembers
  const ios = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await ios.goto(BASE + "/");
  await ios.getByTestId("ios-steps").waitFor();
  assert((await ios.getByTestId("ios-steps").textContent()).includes("Add to Home Screen"), "iPhone: shows Share → Add to Home Screen steps");
  await ios.getByRole("button", { name: "Not now" }).click();
  await ios.reload();
  await ios.getByTestId("home-collage").waitFor();
  await ios.waitForTimeout(500);
  assert((await ios.getByTestId("install-prompt").count()) === 0, "'Not now' hides the tip for good on that phone");

  await browser.close();
  console.log("\nAll install checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
