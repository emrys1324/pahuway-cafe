// Padaya 2.0, Phase 2 — car rental: staff set up a car (Vehicles tab), it appears on the hub (Cars tile/pill, Explore,
// listing row), customers book it self-drive (license) or with a driver (no license, driver fee), staff see "with driver".
// Needs local Supabase + seed:users + app on :3000.  Run: npm run test:cars
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
const PHONE = "09175550133";
const PASS = "Kape-sa-umaga-1";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("delete from rental_bookings where scooter_id in (select id from scooters where vehicle_type = 'car')");
  sql("delete from scooters where vehicle_type = 'car' and name <> 'Sample car — edit me'");
  sql("insert into scooters (name, description, daily_rate, units, is_active, vehicle_type, seats, transmission, fuel, driver_fee, sort_order) select 'Sample car — edit me', 'Replace with your car', 2500, 1, false, 'car', 5, 'automatic', 'gasoline', 1000, 100 where not exists (select 1 from scooters where vehicle_type = 'car')");
  sql("update scooters set is_active = false where vehicle_type = 'car'");
  sql("update store_settings set require_account = true, is_open = true, open_time = '00:00', close_time = '23:59'");
  sql("update rental_settings set bookings_enabled = true, terms = coalesce(nullif(terms, ''), 'Test terms.'), online_enabled = false, deposit_percent = 30");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Carlo Car", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");

  const browser = await chromium.launch();
  try {
    // ---- before: the sample car is hidden → Cars still "Soon"
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/explore?cat=rentals&type=cars");
    await g.getByTestId("coming-soon").waitFor();
    assert((await g.getByTestId("coming-soon").innerText()).includes("Car rentals are coming soon"), "with only the hidden sample car, Vehicle Rentals → Car rentals says Coming soon");

    // ---- staff: edit the sample car in Rentals → Vehicles and switch it on
    const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
    await admin.goto(BASE + "/login");
    await admin.fill("#email", "admin@pahuway.cafe");
    await admin.fill("#password", "ChangeMe-Admin-2026");
    await admin.click("button:has-text('Sign in')");
    await admin.waitForURL(BASE + "/admin");
    await admin.goto(BASE + "/admin/rentals");
    await admin.getByRole("tab", { name: "vehicles" }).click();
    const row = admin.getByTestId("scooter-row").filter({ hasText: "Sample car" });
    await row.waitFor();
    assert((await row.innerText()).includes("5 seats · Automatic · Gasoline") && /hidden/i.test(await row.innerText()), "Vehicles tab lists the hidden sample car with its specs");
    await row.getByRole("button", { name: "Edit" }).click();
    await admin.getByTestId("car-fields").waitFor();
    await admin.locator("#scooter-name").fill("Toyota Vios 2024");
    await admin.locator("#scooter-rate").fill("2800");
    await admin.locator("#car-seats").fill("5");
    await admin.locator("#car-transmission").selectOption("manual");
    await admin.locator("#car-driver-fee").fill("1200");
    await admin.getByRole("switch", { name: "Show on the booking page" }).click();
    await admin.getByRole("button", { name: "Save car" }).click();
    await admin.getByTestId("scooter-row").filter({ hasText: "Toyota Vios 2024" }).waitFor();
    await admin.waitForTimeout(500);
    const saved = sql("select name || '|' || daily_rate || '|' || transmission || '|' || driver_fee || '|' || is_active from scooters where vehicle_type = 'car'");
    assert(saved === "Toyota Vios 2024|2800.00|manual|1200.00|true", `staff can edit the car (name, rate, transmission, driver fee) and switch it on (${saved})`);

    // ---- hub: Cars opens up
    await g.goto(BASE + "/");
    await g.getByTestId("row-rentals").locator("[data-kind=car]").waitFor({ timeout: 10000 });
    assert((await g.getByTestId("collage-rentals").innerText()).includes("Scooters & cars"), "the car appears in 'Scooters and car rentals'; Vehicle Rentals covers scooters & cars");
    await g.goto(BASE + "/explore?cat=rentals&type=cars");
    await g.getByTestId("results").waitFor();
    const card = await g.getByTestId("results").getByTestId("listing-card").innerText();
    assert(card.includes("Toyota Vios 2024") && card.includes("5 seats · Manual · Gasoline") && card.includes("with or without driver"), "Vehicle Rentals → Car rentals lists it with seats, transmission, fuel and the driver option");

    // ---- customer books it with a driver (no license needed)
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    const carId = sql("select id from scooters where vehicle_type = 'car'");
    await c.goto(BASE + `/baybayin?type=car&scooter=${carId}`);
    await c.getByRole("heading", { name: "Rent a car" }).waitFor();
    assert((await c.getByTestId("vehicle-switch").getByRole("tab", { name: /Cars/ }).getAttribute("aria-selected")) === "true", "the Baybayin page opens on Cars (Scooters | Cars switch)");
    await c.getByRole("radio", { name: /Toyota Vios 2024/ }).waitFor();
    assert((await c.getByRole("radio", { name: /Toyota Vios 2024/ }).getAttribute("aria-checked")) === "true", "the car from the card is pre-selected");
    assert((await c.getByRole("radiogroup", { name: "Helmets" }).count()) === 0, "no helmet choice for cars");
    assert((await c.locator("input[aria-label=\"Driver's license photo\"]").count()) === 1, "self-drive asks for a license photo");
    await c.getByTestId("with-driver").locator("input").check();
    assert((await c.locator("input[aria-label=\"Driver's license photo\"]").count()) === 0, "with a driver, no license photo is needed");
    await c.getByTestId("driver-fee").waitFor();
    const summary = (await c.getByTestId("rental-summary").innerText()).replace(/\s+/g, " ");
    assert(/Driver · \d+ days? × ₱1,200/.test(summary), `summary adds the driver fee (${summary.slice(0, 160)})`);
    await c.getByLabel("I have read and agree to the terms and conditions").check();
    await c.setInputFiles("input[aria-label='GCash payment screenshot']", F("gcash-receipt.png"));
    await c.getByRole("button", { name: /Book & send/ }).click();
    await c.waitForURL(/\/baybayin\/booking\//, { timeout: 20000 });
    await c.getByText("with our driver").first().waitFor();
    const b = sql(`select with_driver::text || '|' || (license_path is null)::text || '|' || driver_fee || '|' || helmets from rental_bookings where customer_phone = '${PHONE}' order by created_at desc limit 1`);
    assert(b.startsWith("true|true|") && b.endsWith("|0") && Number(b.split("|")[2]) >= 1200, `booking saved with driver, no license, driver fee, no helmets (${b})`);
    assert((await c.getByTestId("status-driver-fee").count()) === 1, "the customer's booking page shows 'with our driver' and the driver fee");

    // ---- staff see it
    await admin.goto(BASE + "/admin/rentals");
    await admin.getByText("Toyota Vios 2024").first().click();
    await admin.getByTestId("booking-with-driver").waitFor();
    assert((await admin.getByText("Not needed — booked with our driver.").count()) === 1, "staff see 'With driver' and that no license is needed");
    console.log("ALL CAR RENTAL CHECKS PASSED");
  } finally {
    sql("update scooters set is_active = false where vehicle_type = 'car'");
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
