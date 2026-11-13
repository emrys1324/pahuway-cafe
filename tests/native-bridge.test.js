// Exercises the app-only code paths in a browser by loading Capacitor's real Android
// bridge script with a fake native side. Verifies push registration for staff/riders,
// "Notify me" for customers, and that Android builds without Firebase never call the
// push plugin (it would crash). Needs local Supabase + seed:users + app on :3000.
// Run: node tests/native-bridge.test.js
const { chromium, devices } = require("playwright");
const { readFileSync } = require("fs");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const bridgeJs = readFileSync(path.join(__dirname, "../node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js"), "utf8");

// Same return types the real Android bridge declares: listeners are callbacks, not promises
const RTYPE = { addListener: "callback", removeListener: "none", removeAllListeners: "promise" };
const P = (name, methods) => ({ name, methods: methods.map((m) => ({ name: m, rtype: RTYPE[m] || "promise" })) });
const HEADERS = [
  P("PushNotifications", ["checkPermissions", "requestPermissions", "register", "createChannel", "addListener", "removeListener", "removeAllListeners"]),
  P("StatusBar", ["setStyle", "setBackgroundColor"]),
  P("SplashScreen", ["hide"]),
  P("IslaConfig", ["get"]),
];

// Runs in the page before any app code. `pushEnabled` = was Firebase built into this APK?
function fakeNative({ headers, pushEnabled, token }) {
  window.__nativeCalls = [];
  const listeners = {};
  window.androidBridge = {
    postMessage(json) {
      const c = JSON.parse(json);
      window.__nativeCalls.push(c.pluginId + "." + c.methodName);
      const reply = (data, success = true, save = false) =>
        setTimeout(() => window.Capacitor.fromNative({ callbackId: c.callbackId, pluginId: c.pluginId, methodName: c.methodName, success, data, save }), 5);
      const key = c.pluginId + "." + c.methodName;
      if (key === "IslaConfig.get") return reply({ pushEnabled, versionName: "1.0.0", versionCode: 1 });
      if (key === "PushNotifications.checkPermissions") return reply({ receive: "prompt" });
      if (key === "PushNotifications.requestPermissions") return reply({ receive: "granted" });
      if (key === "PushNotifications.removeListener") return; // RETURN_NONE on a real device: no reply
      if (key === "PushNotifications.addListener") {
        listeners[c.options.eventName] = c.callbackId;
        return; // kept-alive callback; events delivered later
      }
      if (key === "PushNotifications.register") {
        if (!pushEnabled) throw new Error("CRASH: push plugin called without Firebase");
        reply({});
        const cb = listeners.registration;
        if (cb) setTimeout(() => window.Capacitor.fromNative({ callbackId: cb, pluginId: "PushNotifications", methodName: "addListener", success: true, data: { value: token }, save: true }), 20);
        return;
      }
      reply({});
    },
  };
  // the native side injects plugin headers next to the bridge
  window.Capacitor = window.Capacitor || {};
  window.Capacitor.PluginHeaders = headers;
}

const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

async function appPage(browser, opts, device = devices["Pixel 7"]) {
  const ctx = await browser.newContext({ ...device });
  await ctx.addInitScript(fakeNative, { headers: HEADERS, ...opts });
  await ctx.addInitScript({ content: bridgeJs });
  await ctx.addInitScript(() => { window.Capacitor.PluginHeaders = window.Capacitor.PluginHeaders || []; });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  if (process.env.DEBUG_NATIVE) {
    page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 300)));
    page.on("request", (r) => r.url().includes("/rpc/") && console.log("rpc:", r.url().split("/rpc/")[1], r.postData()));
    page.on("response", (r) => r.url().includes("/rpc/") && console.log("rpc response:", r.status(), r.url().split("/rpc/")[1]));
    page.on("requestfailed", (r) => r.url().includes("/rpc/") && console.log("rpc FAILED:", r.failure()?.errorText));
  }
  return page;
}
const calls = (p) => p.evaluate(() => window.__nativeCalls);

(async () => {
  sql("update store_settings set require_account = false"); // guest orders/bookings (the sign-in gate has its own test)
  const { execFileSync } = require("child_process");
  const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
  sql("delete from push_tokens; update store_settings set open_time='00:00', close_time='00:00', is_open=true;");
  const browser = await chromium.launch();

  // 1. Staff tablet, Firebase build: opening /admin registers the device for new-order alerts
  const admin = await appPage(browser, { pushEnabled: true, token: "fcm-admin-tablet-token-1234567890" }, devices["Galaxy Tab S4"]);
  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");
  await admin.waitForFunction(() => window.__nativeCalls.includes("PushNotifications.register"), null, { timeout: 10000 });
  await admin.waitForTimeout(800);
  assert(await admin.evaluate(() => document.documentElement.classList.contains("native-app")), "app mode detected inside the native shell");
  const ac = await calls(admin);
  assert(ac.includes("StatusBar.setStyle") && ac.includes("SplashScreen.hide"), "status bar styled and splash hidden on launch");
  assert(ac.filter((c) => c === "PushNotifications.createChannel").length === 2, "two Android notification channels created");
  assert(ac.includes("PushNotifications.requestPermissions"), "staff asked for notification permission");
  const row = sql("select platform || '|' || u.role from push_tokens t join users u on u.id = t.user_id where token = 'fcm-admin-tablet-token-1234567890'");
  assert(row === "android|admin", "staff tablet token saved and linked to the admin account");

  // sign-out unlinks the shared tablet
  await admin.getByRole("button", { name: "Sign out" }).first().click();
  await admin.waitForURL(/\/login/);
  assert(sql("select coalesce(user_id::text,'null') from push_tokens where token = 'fcm-admin-tablet-token-1234567890'") === "null", "signing out unlinks the tablet from staff alerts");

  // 2. Customer, Firebase build: "Notify me" on the order page subscribes this phone to the order
  const cust = await appPage(browser, { pushEnabled: true, token: "fcm-guest-phone-token-1234567890" });
  await cust.goto(BASE + "/menu");
  await cust.locator("article", { hasText: "Ensaymada" }).getByRole("button", { name: "Add Ensaymada" }).click();
  await cust.getByRole("button", { name: /^Add · / }).click();
  await cust.getByRole("button", { name: /View cart/ }).click();
  await cust.getByRole("link", { name: "Checkout" }).click();
  await cust.fill("#name", "App Guest");
  await cust.fill("#phone", "09171112222");
  await cust.getByRole("button", { name: /Place order/ }).click();
  await cust.waitForURL(/\/order\//);
  await cust.getByText("Get notified when it's ready").waitFor();
  assert(!(await calls(cust)).includes("PushNotifications.requestPermissions"), "customer is not prompted until they tap Notify me");
  await cust.screenshot({ path: path.join(__dirname, "../docs/screenshots/12-app-notify-me.png") });
  await cust.getByRole("button", { name: "Notify me" }).click();
  await cust.getByText("We'll notify you when your order status changes.").waitFor({ timeout: 10000 });
  const subs = sql("select count(*) from order_push_subscriptions s join push_tokens t using (token) where t.token = 'fcm-guest-phone-token-1234567890'");
  assert(subs === "1", "guest phone subscribed to its order");

  // 3. Android build WITHOUT Firebase: never touches the push plugin (would crash), hides Notify me
  const nofb = await appPage(browser, { pushEnabled: false, token: "x" });
  await nofb.goto(BASE + "/rider");
  await nofb.fill("#email", "rider@pahuway.cafe");
  await nofb.fill("#password", "ChangeMe-Rider-2026");
  await nofb.click("button:has-text('Sign in')");
  await nofb.waitForURL(BASE + "/rider");
  await nofb.getByRole("heading", { name: "My deliveries" }).waitFor();
  await nofb.waitForTimeout(1000);
  const nc = await calls(nofb);
  assert(nc.includes("IslaConfig.get"), "app checks whether this build supports push");
  assert(!nc.some((c) => c.startsWith("PushNotifications.re")), "no push permission/register calls without Firebase (no crash)");
  assert(!(await nofb.getByText("Notifications are off").count()), "no misleading 'notifications are off' warning");
  const token = sql("select public_token from orders where customer_name = 'App Guest' order by created_at desc limit 1");
  await nofb.goto(BASE + "/order/" + token);
  await nofb.getByText("Order number").waitFor();
  assert(!(await nofb.getByText("Get notified when it's ready").count()), "Notify me card hidden when the build can't do push");

  // 4. Plain browser: none of this runs
  const web = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await web.goto(BASE + "/order/" + token);
  await web.getByText("Order number").waitFor();
  assert(!(await web.getByText("Get notified when it's ready").count()), "website visitors don't see app-only UI");

  await browser.close();
  console.log("\nALL NATIVE BRIDGE TESTS PASSED");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
