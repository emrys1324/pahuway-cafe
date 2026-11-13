// Rider sign-in page (/rider/login) and the "Padaya Rider" home-screen app.
// Start the app (npx next start -p 3000) with the local stack + seeded users; run: npm run test:rider-login
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext(devices["Pixel 7"])).newPage();

  await page.goto(BASE + "/rider");
  await page.waitForURL(BASE + "/rider/login");
  await page.getByRole("heading", { name: "Rider sign in" }).waitFor();
  assert((await page.textContent("body")).includes("Padaya Rider"), "signed out, /rider opens the rider sign-in page (Padaya Rider branding)");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const m = await (await fetch(BASE + manifestHref)).json();
  assert(manifestHref.startsWith("/rider/manifest") && m.name === "Padaya Rider" && m.start_url === "/rider" && m.display === "standalone" && m.icons.length >= 2, "rider pages install as their own home-screen app 'Padaya Rider' that opens at /rider");
  assert((await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content")) === "Padaya Rider", "iPhone home-screen name: Padaya Rider");

  // staff/admin can't use the rider sign-in
  await page.locator("#rider-email").fill("admin@pahuway.cafe");
  await page.locator("#rider-password").fill("ChangeMe-Admin-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("This sign-in is for delivery riders").waitFor();
  assert(page.url() === BASE + "/rider/login", "an admin/staff login is turned away on the rider page (and signed out)");

  // wrong password
  await page.locator("#rider-email").fill("rider@pahuway.cafe");
  await page.locator("#rider-password").fill("nope-nope");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Wrong email or password.").waitFor();

  // rider signs in → deliveries; sign out → back to rider sign-in
  await page.locator("#rider-password").fill("ChangeMe-Rider-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(BASE + "/rider");
  await page.getByRole("heading", { name: "My deliveries" }).waitFor();
  assert(true, "a rider signs in and lands on My deliveries");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/rider/login");
  assert(true, "signing out returns to the rider sign-in page");

  // staff sign-in page links to the rider one
  await page.goto(BASE + "/login");
  await page.getByRole("heading", { name: "Staff sign in" }).waitFor();
  await page.getByRole("link", { name: "Rider sign in" }).click();
  await page.waitForURL(BASE + "/rider/login");
  assert(true, "the staff sign-in page links to Rider sign in");

  // riders can still use the staff sign-in page (old link) and land on their deliveries
  await page.goto(BASE + "/login");
  await page.fill("#email", "rider@pahuway.cafe");
  await page.fill("#password", "ChangeMe-Rider-2026");
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(BASE + "/rider");
  assert(true, "riders who use the old /login link still land on their deliveries");

  // rider.<domain>: the rider pages only (rider.padaya.test → this test server)
  const rb = await chromium.launch({ args: ["--host-resolver-rules=MAP rider.padaya.test 127.0.0.1"] });
  const RB = BASE.replace("localhost", "rider.padaya.test");
  const rp = await (await rb.newContext(devices["Pixel 7"])).newPage();
  await rp.goto(RB + "/");
  await rp.waitForURL(RB + "/rider/login");
  await rp.getByRole("heading", { name: "Rider sign in" }).waitFor();
  assert(true, "rider.<domain>/ opens the rider sign-in");
  await rp.locator("#rider-email").fill("rider@pahuway.cafe");
  await rp.locator("#rider-password").fill("ChangeMe-Rider-2026");
  await rp.getByRole("button", { name: "Sign in" }).click();
  await rp.waitForURL(RB + "/rider");
  await rp.getByRole("heading", { name: "My deliveries" }).waitFor();
  await rp.goto(RB + "/");
  await rp.getByRole("heading", { name: "My deliveries" }).waitFor();
  assert(new URL(rp.url()).pathname === "/", "signed in, rider.<domain>/ shows My deliveries (address stays on the rider domain)");
  await rp.goto(RB + "/login");
  await rp.waitForURL(RB + "/rider/login").catch(() => null);
  await rp.waitForURL(RB + "/rider"); // signed in: the rider sign-in hands over to My deliveries
  assert(new URL(rp.url()).host.startsWith("rider.padaya.test"), "rider.<domain>/login stays on the rider domain (rider sign-in → My deliveries)");
  // (here the main site and the test server share one address, so check the redirect itself)
  const loc = await new Promise((res) => require("http").get({ host: "127.0.0.1", port: 3000, path: "/admin", headers: { host: "rider.padaya.test:3000" } }, (r) => res([r.statusCode, r.headers.location])).on("error", () => res([0, ""])));
  assert(loc[0] === 307 && /\/admin$/.test(loc[1]) && !/rider/.test(loc[1]), `other pages on the rider domain (e.g. /admin) redirect to the main site's page (${loc.join(" ")})`);
  const man = await new Promise((res) => require("http").get({ host: "127.0.0.1", port: 3000, path: "/rider/manifest.webmanifest", headers: { host: "rider.padaya.test:3000" } }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res([r.statusCode, d])); }).on("error", () => res([0, ""])));
  assert(man[0] === 200 && JSON.parse(man[1]).name === "Padaya Rider", "the rider home-screen app works on the rider domain");
  const r4 = await fetch(BASE + "/menu", { redirect: "manual" });
  assert(r4.status === 200, "the main site is unchanged (menu still loads normally)");
  await rb.close();

  await browser.close();
  console.log("\nAll rider sign-in checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
