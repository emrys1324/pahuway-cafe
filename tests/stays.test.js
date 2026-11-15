// Padaya 2.0, Phase 3 — Stays: staff open bookings and set up a property + room, it appears on the hub (Stays tile, row,
// Explore), a customer books dates with an ID photo and a GCash deposit, staff confirm it, the customer sees it live
// in Activity / Messages, and the booked nights show as taken on the calendar.
// Needs local Supabase + seed:users + app on :3000.  Run: npm run test:stays
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const F = (n) => path.join(__dirname, "fixtures", n);
const PHONE = "09175550155";
const PASS = "Kape-sa-umaga-1";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("delete from stay_bookings");
  sql("delete from stay_rooms; delete from stay_properties");
  sql("with p as (insert into stay_properties (name, description, location_text, amenities, house_rules, is_active) values ('Sample property — edit me', 'Replace with your place.', 'San Agustin, Romblon', array['Wi-Fi', 'Air-con', 'Hot shower', 'Parking'], 'No smoking indoors.', false) returning id) insert into stay_rooms (property_id, name, nightly_rate, weekend_rate, max_guests, units, min_nights) select id, 'Sample room — edit me', 1800, 2200, 2, 1, 1 from p");
  sql("update stay_settings set bookings_enabled = false, terms = null, deposit_percent = 30, free_cancel_days = 3, max_nights = 30");
  sql("update store_settings set require_account = true, is_open = true, open_time = '00:00', close_time = '23:59'");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Stella Stay", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");
  // a Thursday about 5 weeks ahead: Thu → Sun = Thu at the weekday rate + Fri & Sat at the weekend rate
  const thu = sql("select to_char(d, 'YYYY-MM-DD') from (select (current_date + 35 + ((4 - extract(isodow from current_date + 35)::int + 7) % 7))::date d) x");
  const sun = sql(`select to_char('${thu}'::date + 3, 'YYYY-MM-DD')`);

  const browser = await chromium.launch();
  try {
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/");
    await g.getByTestId("tile-stays").waitFor();
    assert((await g.getByTestId("tile-stays").innerText()).includes("Coming soon") && (await g.getByTestId("row-stays").count()) === 0, "before setup: Stays says Coming soon, no Top stays row");
    await g.goto(BASE + "/stays");
    await g.getByTestId("stays-soon").waitFor();
    assert(true, "/stays shows Coming soon while bookings are off");

    // ---- staff: Stays page in the menu; write terms + switch on; edit sample property + room and show them
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.getByRole("link", { name: "Stays", exact: true }).first().click();
    await admin.waitForURL(BASE + "/admin/stays");
    await admin.getByRole("tab", { name: "settings" }).click();
    const sw = admin.getByRole("switch", { name: "Accept stay bookings" });
    await sw.waitFor();
    assert(await sw.isDisabled(), "Accept stay bookings can't be switched on before house rules are written");
    await admin.getByLabel("House rules & cancellation policy (guests must agree)").fill("Quiet hours from 10 PM.\nFree cancellation up to 3 days before check-in.");
    await admin.getByRole("button", { name: "Save settings" }).click();
    await admin.getByText("Stay settings saved.").waitFor();
    await sw.click();
    await admin.getByRole("button", { name: "Save settings" }).click();
    await admin.waitForTimeout(600);
    assert(sql("select bookings_enabled from stay_settings") === "t", "staff write the house rules and switch stay bookings on");

    await admin.getByRole("tab", { name: "rooms" }).click();
    const prop = admin.getByTestId("admin-property").filter({ hasText: "Sample property" });
    await prop.waitFor();
    await prop.getByRole("button", { name: "Edit property" }).click();
    const pf = admin.getByTestId("property-form");
    await pf.getByLabel("Name").fill("Casa Tablas");
    await pf.getByLabel("Location").fill("Brgy. Poblacion, San Agustin");
    await pf.getByLabel("Amenities (comma-separated)").fill("Wi-Fi, Air-con, Hot shower, Beachfront");
    await pf.getByRole("switch", { name: "Show property" }).click();
    await pf.getByRole("button", { name: "Save property" }).click();
    await admin.getByTestId("admin-property").filter({ hasText: "Casa Tablas" }).waitFor();
    await admin.getByTestId("admin-room").filter({ hasText: "Sample room" }).click();
    const rf = admin.getByTestId("room-form");
    await rf.getByLabel("Room name").fill("Garden room");
    await rf.getByLabel("Nightly rate (₱)").fill("1800");
    await rf.getByLabel("Fri & Sat rate (₱, optional)").fill("2200");
    await rf.getByLabel("Max guests").fill("2");
    if ((await rf.getByRole("switch", { name: "Show room" }).getAttribute("aria-checked")) !== "true") await rf.getByRole("switch", { name: "Show room" }).click();
    await rf.getByRole("button", { name: "Save room" }).click();
    await admin.getByTestId("admin-room").filter({ hasText: "Garden room" }).waitFor();
    const saved = sql("select p.name || '|' || p.is_active || '|' || r.name || '|' || r.nightly_rate || '|' || r.weekend_rate || '|' || r.is_active from stay_rooms r join stay_properties p on p.id = r.property_id");
    assert(saved === "Casa Tablas|true|Garden room|1800.00|2200.00|true", `staff edit the property and room (rates, Fri & Sat rate) and show them (${saved})`);
    const roomId = sql("select id from stay_rooms");

    // ---- hub: Stays opens up
    await g.goto(BASE + "/");
    await g.getByTestId("tile-stays").getByText("From ₱1,800/night").waitFor({ timeout: 10000 });
    assert(!/soon/i.test((await g.getByTestId("pill-stays").innerText()).replace(/\s+/g, " ")), "Stays tile shows 'From ₱1,800/night' and the Stays button is no longer 'Soon'");
    assert((await g.getByTestId("row-stays").getByTestId("listing-card").count()) === 1 && (await g.getByTestId("stays-teaser").innerText()).includes("Tours are coming soon"), "home shows a Top stays row; the teaser now only says Tours are coming soon");
    await g.goto(BASE + "/explore?cat=stays");
    await g.getByTestId("results").waitFor();
    const card = await g.getByTestId("results").getByTestId("listing-card").innerText();
    assert(card.includes("Garden room") && card.includes("Casa Tablas") && card.includes("₱1,800 / night"), "Explore → Stays lists the room with its property and price");
    await g.goto(BASE + "/explore?q=beach%20room");
    await g.getByTestId("results").waitFor();
    assert((await g.getByTestId("results").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.dataset.kind))).join() === "stay", "searching 'beach room' finds the stay");
    await g.getByTestId("results").getByTestId("listing-card").click();
    await g.waitForURL(BASE + `/stays/${roomId}`);
    await g.getByTestId("stay-amenities").waitFor();
    assert((await g.getByTestId("stay-amenities").innerText()).includes("Beachfront") && (await g.getByTestId("stay-rates").innerText()).includes("Fri & Sat ₱2,200"), "room page: amenities and weekday / Fri & Sat rates");
    await g.getByTestId("signin-gate").getByText("to book a stay").waitFor();
    assert(true, "guests are asked to sign in to book a stay");

    // ---- customer books Thu → Sun
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    await c.goto(BASE + `/stays/${roomId}`);
    await c.getByTestId("stay-form").waitFor();
    assert((await c.locator("#guest-name").inputValue()) === "Stella Stay" && (await c.locator("#guest-phone").inputValue()) === PHONE, "name and mobile are filled in from the account");
    await c.getByLabel("Check-in date").fill(thu);
    await c.getByLabel("Check-out date").fill(sun);
    await c.getByTestId("stay-summary").waitFor();
    const summary = (await c.getByTestId("stay-summary").innerText()).replace(/\s+/g, " ");
    assert(summary.includes("1 night × ₱1,800") && summary.includes("2 Fri/Sat nights × ₱2,200") && (await c.getByTestId("stay-total").innerText()) === "₱6,200" && (await c.getByTestId("stay-deposit").innerText()) === "₱1,860", `summary: 1 weekday + 2 Fri/Sat nights = ₱6,200, deposit 30% = ₱1,860 (${summary.slice(0, 140)})`);
    assert((await c.getByTestId("cancel-policy").innerText()).includes("Free cancellation up to 3 days before"), "the cancellation policy is shown before paying");
    await c.getByRole("button", { name: "Book this stay" }).click();
    await c.getByText("Please add a photo of a valid ID.").waitFor();
    assert(true, "booking without an ID photo asks for one");
    await c.setInputFiles("input[aria-label='Valid ID photo']", F("test-logo.png"));
    await c.getByLabel("I have read and agree to the house rules and cancellation policy").check();
    assert((await c.getByTestId("gcash-amount").innerText()) === "₱1,860", "after agreeing, GCash payment shows the ₱1,860 deposit");
    await c.setInputFiles("input[aria-label='GCash payment screenshot']", F("gcash-receipt.png"));
    await c.getByRole("button", { name: "Book this stay" }).click();
    await c.waitForURL(/\/stays\/booking\//, { timeout: 20000 });
    await c.getByTestId("stay-number").waitFor();
    const no = (await c.getByTestId("stay-number").innerText()).trim();
    assert(/^ST-\d{4}$/.test(no) && /checking deposit/i.test(await c.getByTestId("stay-status").innerText()), `booked: ${no}, status 'Checking deposit'`);
    const row = sql(`select nights || '|' || total || '|' || deposit_amount || '|' || (id_photo_path like 'licenses/stays/%') || '|' || (payment_proof_path like 'proofs/stays/%') || '|' || (customer_user_id is not null) from stay_bookings where booking_number = '${no}'`);
    assert(row === "3|6200.00|1860.00|true|true|true", `saved: 3 nights, ₱6,200, ₱1,860 deposit, private ID + receipt, linked to the account (${row})`);
    assert((await c.getByTestId("stay-details").innerText()).includes("from 2:00 PM") && (await c.getByTestId("stay-balance").innerText()).includes("₱4,340"), "status page: check-in time and ₱4,340 balance at check-in");

    // ---- the nights are now taken
    await g.goto(BASE + `/stays/${roomId}`);
    await g.getByTestId("stay-gallery").waitFor();
    const thuDate = new Date(thu + "T00:00:00Z");
    const months = (thuDate.getUTCFullYear() - new Date().getUTCFullYear()) * 12 + thuDate.getUTCMonth() - new Date().getUTCMonth();
    await c.goto(BASE + `/stays/${roomId}`);
    await c.getByTestId("stay-calendar").waitFor();
    for (let i = 0; i < months; i++) await c.getByRole("button", { name: "Next month" }).click();
    await c.waitForFunction((d) => document.querySelector(`[data-day="${d}"]`)?.getAttribute("data-tone") === "booked", thu, { timeout: 10000 });
    assert((await c.locator(`[data-day="${sun}"]`).getAttribute("data-tone")) === "free", "calendar: the booked nights are struck through; check-out day is free again");
    await c.getByLabel("Check-in date").fill(thu);
    await c.getByLabel("Check-out date").fill(sun);
    await c.getByText(/Fully booked on/).waitFor();
    assert(true, "choosing taken nights warns 'Fully booked' before paying");

    // ---- staff confirm the deposit
    await admin.getByRole("tab", { name: "bookings" }).click();
    const sr = admin.getByTestId("stay-row").filter({ hasText: no });
    await sr.waitFor({ timeout: 10000 });
    await sr.click();
    await admin.getByTestId("id-photo").waitFor();
    await admin.getByTestId("proof-photo").waitFor();
    assert((await admin.getByTestId("sheet-deposit").innerText()) === "₱1,860", "staff open the stay and see the ID photo, GCash receipt and deposit");
    await admin.getByRole("button", { name: /Deposit received/ }).click();
    await admin.waitForTimeout(800);
    assert(sql(`select status || '|' || payment_status from stay_bookings where booking_number = '${no}'`) === "confirmed|deposit_paid", "Deposit received → confirmed, deposit paid");
    await c.goto(BASE + "/messages");
    await c.getByTestId("messages-list").getByText(`Stay ${no} · confirmed`).waitFor({ timeout: 10000 });
    assert(true, "the customer gets a 'Stay … confirmed' message");
    await c.getByTestId("messages-list").getByText(`Stay ${no} · confirmed`).click();
    await c.waitForURL(/\/stays\/booking\//);
    await c.getByTestId("stay-status").getByText(/confirmed/i).waitFor();
    assert(true, "tapping it opens the stay, now Confirmed");
    await c.goto(BASE + "/activity");
    await c.getByTestId("history").getByRole("tab", { name: /^Stays/ }).click();
    await c.getByTestId("history-stays").getByText(no, { exact: false }).waitFor();
    assert((await c.getByTestId("history").getByRole("tab", { name: /^Stays/ }).innerText()).replace(/\s+/g, " ").includes("(1)"), "Activity → Stays lists the stay");

    // ---- check in, check out
    await admin.getByRole("button", { name: /Guest checked in/ }).click();
    await admin.getByRole("button", { name: "Guest checked out" }).click();
    await admin.waitForTimeout(800);
    assert(sql(`select status || '|' || payment_status from stay_bookings where booking_number = '${no}'`) === "checked_out|paid", "staff check the guest in (balance paid) and out");
    console.log("ALL STAY CHECKS PASSED");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
