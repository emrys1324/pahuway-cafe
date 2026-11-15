// Tours (coming soon): the Tours card → /tours, "Notify me" for guests and signed-in customers (pre-filled,
// "You're on the list", update picks), the staff Tours page (list, most wanted, mark all as told), Explore → Tours link.
// Needs local Supabase + seed:users + app on :3000.  Run: npm run test:tours
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const PHONE = "09175550177";
const PASS = "Kape-sa-umaga-1";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("delete from tour_signups");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Toni Tour", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");

  const browser = await chromium.launch();
  try {
    // ---- guest
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/");
    await g.getByTestId("cat-tours").click();
    await g.waitForURL(BASE + "/tours");
    await g.getByTestId("notify-form").waitFor();
    assert((await g.getByTestId("tours-hero").innerText()).includes("Island tours & activities") && (await g.getByTestId("tours-waiting").count()) === 0, "Tours page: coming soon hero; no 'people waiting' line while the list is empty");
    await g.getByRole("button", { name: "Notify me" }).click();
    await g.getByText("Please enter your name.").waitFor();
    await g.locator("#tour-name").fill("Gina Guest");
    await g.locator("#tour-phone").fill("0917 555 0178");
    await g.getByRole("button", { name: /Island hopping/ }).click();
    await g.getByRole("button", { name: /Snorkeling/ }).click();
    await g.locator("#tour-size").fill("3");
    await g.getByRole("button", { name: "Notify me" }).click();
    await g.getByTestId("notify-done").getByText("You're on the list!").waitFor();
    assert(sql("select name || '|' || phone || '|' || array_to_string(interests, ',') || '|' || group_size from tour_signups") === "Gina Guest|09175550178|Island hopping,Snorkeling & diving|3", "a guest signs up with name, mobile, picks and group size");
    await g.goto(BASE + "/explore?cat=tours");
    await g.getByTestId("tours-notify-link").click();
    await g.waitForURL(BASE + "/tours");
    await g.getByTestId("tours-waiting").getByText("1 person is already on the list").waitFor();
    assert(true, "Explore → Tours links to Notify me; the page shows how many are waiting");

    // ---- signed-in customer: details filled in, message in the inbox, update picks
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    await c.goto(BASE + "/tours");
    await c.waitForFunction(() => document.querySelector("#tour-phone")?.value === "09175550177");
    assert((await c.locator("#tour-name").inputValue()) === "Toni Tour", "signed in: name and mobile are filled in");
    await c.getByRole("button", { name: /Waterfalls/ }).click();
    await c.getByRole("button", { name: "Notify me" }).click();
    await c.getByTestId("notify-done").waitFor();
    await c.getByTestId("unread-badge").waitFor({ timeout: 10000 });
    await c.goto(BASE + "/messages");
    await c.getByTestId("messages-list").getByText("You're on the Tours list").waitFor();
    assert(true, "the customer gets a 'You're on the Tours list' message");
    await c.goto(BASE + "/tours");
    await c.getByRole("button", { name: "Update my picks" }).waitFor();
    assert((await c.getByRole("button", { name: /Waterfalls/ }).getAttribute("aria-pressed")) === "true", "coming back: 'You're on the list ✓' with their picks ticked");
    await c.getByRole("button", { name: /Food & culture/ }).click();
    await c.getByRole("button", { name: "Update my picks" }).click();
    await c.getByTestId("notify-done").getByText("Saved").waitFor();
    assert(sql(`select array_to_string(interests, ',') from tour_signups where phone = '${PHONE}'`) === "Food & culture,Waterfalls & hikes" && sql("select count(*) from tour_signups") === "2", "updating keeps one sign-up per number with the new picks");

    // ---- staff
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.getByRole("link", { name: "Tours", exact: true }).first().click();
    await admin.waitForURL(BASE + "/admin/tours");
    await admin.getByTestId("tour-signup").first().waitFor();
    assert((await admin.getByTestId("tour-signup").count()) === 2 && (await admin.getByTestId("tours-summary").innerText()).includes("2 sign-ups · 2 not told yet"), "staff Tours page lists both sign-ups");
    assert((await admin.getByTestId("tours-tally").innerText()).replace(/\s+/g, " ").includes("Island hopping · 1"), "and what people want most");
    await admin.getByRole("button", { name: "Mark all as told" }).click();
    await admin.getByText("Marked everyone as told.").waitFor();
    assert(sql("select count(*) from tour_signups where notified_at is null") === "0", "Mark all as told");
    console.log("ALL TOUR CHECKS PASSED");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
