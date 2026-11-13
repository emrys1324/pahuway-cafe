// Baybayin scooter rentals end to end (v2): admin adds scooters, writes the terms and opens bookings;
// customers pick days on the availability calendar, upload a license, agree to the terms, then send the
// deposit by GCash with a receipt screenshot; staff check the receipt and verify or reject; staff calendar;
// cancel + "sent back by GCash" refund; reminders; texts via (mock) Semaphore; switch off → Coming soon.
// Start the app with:
//   HITPAY_API_KEY=hp_e2e HITPAY_SALT=salt_e2e HITPAY_API_BASE=http://127.0.0.1:4010 \
//   SEMAPHORE_API_KEY=sm_test SEMAPHORE_API_BASE=http://127.0.0.1:4020 NEXT_PUBLIC_SITE_URL=http://localhost:3000 npx next start -p 3000
// Run: npm run test:rentals
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const { startMockSemaphore } = require("./mock-semaphore");
const { startMockHitpay } = require("./mock-hitpay");
const yamCard = (pg) => pg.getByTestId("scooter-option").filter({ hasText: "Yamaha Mio" });
const BASE = process.env.BASE_URL || "http://localhost:3000";
const F = (n) => path.join(__dirname, "fixtures", n);
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const ymd = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
const until = async (fn, what, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("FAIL: timed out waiting for " + what);
};
const TERMS = "1. Renter must hold a valid driver's license.\n2. Fuel is the renter's responsibility.\n3. The deposit is non-refundable for no-shows.";

/** Show the month containing `d` in a calendar (customer or staff) and return that day's cell. */
async function dayCell(page, root, d) {
  await root.waitFor();
  for (let i = 0; i < 12; i++) {
    const m = await root.getAttribute("data-month");
    if (m === d.slice(0, 7)) break;
    await root.getByRole("button", { name: m < d.slice(0, 7) ? "Next month" : "Previous month" }).click();
    await page.waitForFunction(([el, old]) => el.getAttribute("data-month") !== old, [await root.elementHandle(), m]);
  }
  return root.locator(`[data-day="${d}"]`);
}
async function setTimes(page, start, startTime, end, endTime) {
  await (await dayCell(page, page.getByTestId("availability-calendar"), start)).click();
  await page.locator("#pickup-time").selectOption(startTime);
  await page.locator("#return-date").fill(end);
  await page.locator("#return-time").selectOption(endTime);
}
async function book(page, { scooter, start, end, startTime = "09:00", endTime = "09:00", name, phone, helmets = 1 }) {
  await page.goto(BASE + "/baybayin");
  await page.getByRole("heading", { name: "Rent a scooter" }).waitFor();
  await setTimes(page, start, startTime, end, endTime);
  await page.getByRole("radio", { name: scooter, exact: true }).click();
  await page.locator("#renter-name").fill(name);
  await page.locator("#renter-phone").fill(phone);
  await page.getByRole("radio", { name: helmets === 2 ? "2 (+ passenger)" : helmets === 1 ? "1 (rider)" : "None" }).click();
  await page.setInputFiles("input[aria-label=\"Driver's license photo\"]", F("test-background.png"));
}
async function payGcash(page) {
  await page.getByLabel("I have read and agree to the terms and conditions").check();
  const manual = page.getByRole("radio", { name: /GCash \(send manually\)/ });
  if (await manual.count()) await manual.click();
  await page.setInputFiles("input[aria-label='GCash payment screenshot']", F("test-logo.png"));
  await page.getByRole("button", { name: /^Book & send ₱[\d,]+$/ }).click();
  await page.waitForURL(/\/baybayin\/booking\/[0-9a-f-]{36}$/);
  await page.getByTestId("booking-number").waitFor();
  return (await page.getByTestId("booking-number").textContent()).trim();
}

(async () => {
  sql("update store_settings set require_account = false"); // guest orders/bookings (the sign-in gate has its own test)
  sql("delete from rental_bookings; delete from scooters; update rental_settings set bookings_enabled = false, terms = null, deposit_percent = 30, security_deposit = 0, security_deposit_note = null, delivery_fee = 0, pickup_note = null, max_days = 30, messenger_url = null, open_time = '08:00', close_time = '22:00';");
  sql("update store_settings set gcash_name = 'Pahuway Cafe', gcash_number = '0917 555 0000' where id = 1;");
  const sms = await startMockSemaphore({ port: 4020, apiKey: "sm_test" });
  const hp = await startMockHitpay({ port: 4010, salt: "salt_e2e", apiKey: "hp_e2e" });
  sql("update rental_settings set online_enabled = false;");
  const textsTo = (n, re) => sms.messages.filter((m) => m.number === n && (!re || re.test(m.message)));
  sql("delete from rental_sms_log; update rental_settings set sms_enabled = true, staff_alert_phones = null, reminder_hours = 3;");
  const browser = await chromium.launch();
  const phone = devices["iPhone 13"];

  // ---------- bookings off → Coming soon ----------
  const cust = await (await browser.newContext(phone)).newPage();
  await cust.goto(BASE + "/baybayin");
  await cust.getByText("Coming soon").first().waitFor();
  assert((await cust.getByRole("heading", { name: "Rent a scooter" }).count()) === 0, "with bookings off, the Baybayin page shows Coming soon");

  // ---------- admin: scooters + settings ----------
  const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
  admin.on("dialog", (d) => d.accept());
  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");
  await admin.getByRole("link", { name: "Rentals", exact: true }).click();
  await admin.getByRole("heading", { name: "Baybayin rentals" }).waitFor();
  await admin.getByRole("tab", { name: "scooters" }).click();
  for (const [n, rate, desc] of [["Honda Click 125", "500", "Automatic · good for 2"], ["Yamaha Mio", "400", "Light and easy"]]) {
    await admin.getByRole("button", { name: "+ Add scooter" }).click();
    await admin.locator("#scooter-name").fill(n);
    await admin.locator("#scooter-desc").fill(desc);
    await admin.locator("#scooter-rate").fill(rate);
    if (n === "Yamaha Mio") await admin.locator("#scooter-security").fill("1000");
    if (n === "Honda Click 125") {
      await admin.setInputFiles("input[aria-label='Scooter photo']", F("test-logo.png"));
      await admin.getByRole("dialog").getByText("Change photo").waitFor();
    }
    await admin.getByRole("button", { name: "Save scooter" }).click();
    await admin.getByText(`${n} saved.`).waitFor();
  }
  assert((await admin.getByTestId("scooter-row").count()) === 2, "admin adds scooters with daily rates and a photo");
  await admin.getByRole("tab", { name: "settings" }).click();
  await admin.getByTestId("terms-needed").waitFor();
  assert(await admin.getByRole("switch", { name: "Accept bookings" }).isDisabled(), "without terms, the Accept bookings switch is locked");
  assert((await admin.locator("#delivery-fee").count()) === 0, "no delivery fee setting (pickup only)");
  assert((await admin.getByText("Settings → Payments").count()) === 1 && (await admin.getByText("(0917 555 0000)").count()) === 1, "settings note: deposits go to the café's GCash from Settings → Payments");
  await admin.locator("#rental-terms").fill(TERMS);
  await admin.locator("#deposit-percent").fill("30");
  await admin.locator("#security-deposit").fill("2000");
  await admin.locator("#security-note").fill("or leave a valid ID");
  await admin.locator("#pickup-note").fill("At Pahuway Cafe, Poblacion — 8 AM to 6 PM");
  assert((await admin.locator("#rental-open").inputValue()) === "08:00" && (await admin.locator("#rental-close").inputValue()) === "22:00", "settings: pickup & return hours default to 8:00 AM – 10:00 PM");
  await admin.locator("#messenger-url").fill("m.me/baybayin");
  await admin.getByRole("button", { name: "Save rental settings" }).click();
  await admin.getByText("The Messenger link must start with https://").waitFor();
  await admin.locator("#messenger-url").fill("https://m.me/baybayin");
  await admin.getByText("Semaphore is connected").waitFor();
  await admin.locator("#staff-alert-phones").fill("09170000001");
  await admin.getByRole("switch", { name: "Accept bookings" }).click();
  await admin.getByRole("button", { name: "Save rental settings" }).click();
  await admin.getByText("Rental settings saved.").waitFor();
  assert(sql("select bookings_enabled::text || deposit_percent || '|' || (terms_updated_at is not null) from rental_settings") === "true30|true", "admin writes the terms, sets a 30% deposit and opens bookings (terms change time-stamped)");

  // ---------- customer books ----------
  const s1 = ymd(2), e1 = ymd(4);
  await cust.goto(BASE + "/baybayin");
  await cust.getByRole("heading", { name: "Rent a scooter" }).waitFor();
  assert(true, "with bookings on and terms written, the Baybayin page becomes the booking page");
  assert((await cust.getByLabel(/Deliver the scooter/).count()) === 0, "no delivery option — all bookings are pickup");
  const opts = await cust.locator("#pickup-time option").allTextContents();
  assert(opts[0] === "8:00 AM" && opts[opts.length - 1] === "10:00 PM" && opts.length === 29 && (await cust.locator("#return-time option").count()) === 29, "pickup and return times only from 8:00 AM to 10:00 PM");
  assert((await cust.getByTestId("rental-hours").textContent()).includes("8:00 AM – 10:00 PM"), "the hours are shown on the booking page");
  await cust.getByLabel("I need a pickup or return outside 8:00 AM – 10:00 PM").check();
  await cust.getByTestId("special-arrangement").waitFor();
  const mhref = await cust.getByTestId("messenger-link").getAttribute("href");
  assert(mhref.startsWith("https://m.me/baybayin?text=") && decodeURIComponent(mhref).includes("outside 8:00 AM – 10:00 PM"), "ticking 'outside hours' shows a Messenger button to the Baybayin page with a ready message");
  assert((await cust.getByRole("heading", { name: "Choose a scooter" }).count()) === 0 && (await cust.getByRole("button", { name: /Book a scooter|deposit/ }).count()) === 0, "…and hides the online booking form (arrange by message instead)");
  await cust.getByLabel("I need a pickup or return outside 8:00 AM – 10:00 PM").uncheck();
  await cust.getByRole("heading", { name: "Choose a scooter" }).waitFor();
  assert(true, "unticking brings the booking form back");
  await cust.getByTestId("availability-calendar").waitFor();
  assert((await cust.getByTestId("rental-terms").textContent()).includes("Fuel is the renter's responsibility"), "the owner's terms are shown on the booking page");
  assert((await cust.getByTestId("gcash-payment").count()) === 0 && (await cust.locator("#gcash-ref").count()) === 0, "the GCash payment form is hidden until the customer agrees to the terms");
  await cust.getByRole("button", { name: /Book a scooter/ }).click();
  await cust.getByText("Choose a scooter.").waitFor();
  await cust.getByText("Please read and agree to the terms and conditions.").first().waitFor();
  assert(true, "form checks: scooter, name, mobile, license photo and the terms are required");
  await book(cust, { scooter: "Honda Click 125", start: s1, end: e1, name: "Ana Reyes", phone: "0917 111 2222", helmets: 2 });
  assert((await cust.locator("#pickup-time").inputValue()) === "09:00" && (await cust.getByTestId("availability-calendar").locator(`[data-day="${s1}"]`).getAttribute("aria-selected")) === "true", "tapping a day on the calendar sets the pickup date");
  await cust.getByTestId("rental-days").getByText("2 days").waitFor();
  const summary = await cust.getByTestId("rental-summary").textContent();
  assert(summary.includes("₱1,000") && summary.includes("₱300") && summary.includes("₱700"), "summary: 2 days × ₱500 = ₱1,000; 30% deposit ₱300; ₱700 at pickup");
  assert((await cust.getByTestId("security-deposit").textContent()).includes("₱2,000") && (await cust.getByTestId("due-at-pickup").textContent()).includes("₱2,700"), "payment summary includes the ₱2,000 security deposit at pickup: ₱700 balance + ₱2,000 = ₱2,700 to bring");
  await cust.getByLabel("I have read and agree to the terms and conditions").check();
  await cust.getByTestId("gcash-payment").waitFor();
  assert((await cust.getByTestId("gcash-amount").textContent()) === "₱300" && (await cust.getByTestId("gcash-payment").textContent()).includes("0917 555 0000"), "after agreeing, the GCash form shows the café's GCash and the ₱300 deposit to send");
  await cust.getByRole("button", { name: "Book & send ₱300" }).click();
  await cust.getByText("Please attach a screenshot of your GCash payment.").waitFor();
  assert((await cust.locator("#gcash-ref").count()) === 0, "GCash: only the payment screenshot is required (no reference number field)");
  const bookingNo = await payGcash(cust);
  await cust.getByText("We're checking your GCash payment").first().waitFor();
  assert(/^BY-\d{4}$/.test(bookingNo), `booking ${bookingNo} made; the customer sees "We're checking your GCash payment"`);
  const row1 = sql(`select status||'|'||payment_status||'|'||payment_method||'|'||coalesce(gcash_reference, '-')||'|'||(payment_proof_path like 'proofs/rentals/%')||'|'||(payment_expires_at is null)||'|'||(terms_snapshot = (select terms from rental_settings))||'|'||delivery from rental_bookings where booking_number='${bookingNo}'`);
  assert(row1 === "awaiting_deposit|for_verification|gcash|-|true|true|true|false", `booking saved for GCash checking, receipt stored privately, terms copy kept, pickup only (${row1})`);
  await until(() => textsTo("09170000001", /New booking/).length === 1, "staff alert");
  const alert = textsTo("09170000001", /New booking/)[0].message;
  assert(alert.includes(bookingNo) && alert.includes("Ana Reyes 09171112222") && alert.includes("GCash P300 - please check the receipt"), `staff get a "check the GCash" text: "${alert}"`);
  assert(textsTo("09171112222").length === 0, "no confirmation text to the customer before staff verify");

  // ---------- availability calendar + no double booking ----------
  const cust2 = await (await browser.newContext(phone)).newPage();
  await cust2.goto(BASE + "/baybayin");
  const cal = cust2.getByTestId("availability-calendar");
  const mid = ymd(3);
  await until(async () => (await (await dayCell(cust2, cal, mid)).getAttribute("data-tone")) === "some", "calendar: some booked");
  assert((await cal.locator(`[data-day="${mid}"]`).getAttribute("aria-label")).includes("1 free"), "calendar (all scooters): a day with one scooter booked shows '1 free'");
  await setTimes(cust2, ymd(3), "12:00", ymd(5), "12:00");
  await until(async () => (await cust2.getByRole("radio", { name: "Honda Click 125 (booked)" }).count()) === 1, "Honda shown as booked");
  assert(await cust2.getByRole("radio", { name: "Honda Click 125 (booked)" }).isDisabled(), "a booking waiting for GCash checking already holds the scooter");
  await cust2.getByRole("radio", { name: "Yamaha Mio", exact: true }).click();
  assert((await cal.locator(`[data-day="${mid}"]`).getAttribute("data-tone")) === "free", "with Yamaha chosen, the calendar shows Yamaha's own availability (free)");
  await setTimes(cust2, e1, "09:30", ymd(5), "09:30");
  await until(async () => (await cust2.getByRole("radio", { name: "Honda Click 125", exact: true }).count()) === 1, "Honda free 30 min after its return");
  await cust2.getByRole("radio", { name: "Honda Click 125", exact: true }).click();
  assert((await cal.locator(`[data-day="${mid}"]`).getAttribute("data-tone")) === "booked", "with Honda chosen, its booked days are greyed out");
  await setTimes(cust2, ymd(7), "09:00", ymd(8), "10:30");
  await cust2.getByTestId("rental-days").getByText("1 day + 2 hours").waitFor();
  await setTimes(cust2, ymd(7), "09:00", ymd(8), "15:00");
  await cust2.getByTestId("rental-days").getByText("1 day + 6 hours").waitFor();
  await setTimes(cust2, ymd(7), "09:00", ymd(8), "16:00");
  await cust2.getByTestId("rental-days").getByText("2 days", { exact: true }).waitFor();
  assert(true, "pricing: 25.5 h = 1 day + 2 extra hours (part of an hour counts), 30 h = 1 day + 6 hours, 31 h = 2 days (7 extra hours = a day)");

  // ---------- staff verify the GCash receipt ----------
  await admin.getByRole("tab", { name: "bookings" }).click();
  await admin.getByRole("radio", { name: /GCash to check \(1\)/ }).click();
  const row = admin.getByTestId("booking-row").filter({ hasText: bookingNo });
  await row.getByText("GCash to check").waitFor();
  await row.click();
  const sheet = admin.getByRole("dialog");
  await sheet.getByText("Ana Reyes").waitFor();
  await until(() => sheet.getByTestId("gcash-receipt").evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), "receipt to load");
  await until(() => sheet.getByTestId("license-photo").evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), "license photo to load");
  assert((await sheet.getByTestId("gcash-proof").textContent()).includes("₱300"), "staff see the amount and the GCash receipt screenshot (private, signed link) next to the license");
  await sheet.getByRole("button", { name: "Deposit verified" }).click();
  await until(() => sql(`select status||'|'||payment_status||'|'||(deposit_paid_at is not null) from rental_bookings where booking_number='${bookingNo}'`) === "confirmed|deposit_paid|true", "verified");
  assert(true, "Deposit verified → booking confirmed, deposit marked paid and time-stamped");
  await until(() => textsTo("09171112222", /is confirmed/).length === 1, "confirmation text");
  const conf = textsTo("09171112222", /is confirmed/)[0].message;
  assert(conf.includes(bookingNo) && conf.includes("Balance at pickup P700") && /^[\x20-\x7E]+$/.test(conf), `customer gets the confirmation text after staff verify: "${conf}"`);
  await cust.reload();
  await cust.getByText("You're booked! Deposit received ✓").waitFor();
  assert((await cust.getByTestId("balance").textContent()) === "₱700" && (await cust.getByTestId("due-at-pickup").textContent()) === "₱2,700", "customer's booking page: booked, ₱700 balance + ₱2,000 security deposit = ₱2,700 to bring at pickup");
  assert((await cust.getByTestId("screenshot-note").textContent()).includes("Take a screenshot of this page and present it upon pickup"), "booking page asks the customer to screenshot it and present it at pickup");
  await sheet.getByRole("button", { name: "Mark picked up" }).click();
  await until(() => sql(`select status from rental_bookings where booking_number='${bookingNo}'`) === "picked_up", "picked up");
  await sheet.getByRole("button", { name: "Balance collected" }).click();
  await until(() => sql(`select payment_status from rental_bookings where booking_number='${bookingNo}'`) === "paid", "paid");
  await sheet.getByRole("button", { name: "Mark returned" }).click();
  await until(() => sql(`select status from rental_bookings where booking_number='${bookingNo}'`) === "returned", "returned");
  assert(true, "pickup → balance collected → return");
  await cust2.goto(BASE + "/baybayin");
  await setTimes(cust2, ymd(3), "12:00", ymd(5), "12:00");
  await until(async () => (await cust2.getByRole("radio", { name: "Honda Click 125", exact: true }).count()) === 1, "Honda free after return");
  await cust2.getByRole("radio", { name: "Honda Click 125", exact: true }).click();
  assert((await cust2.getByTestId("availability-calendar").locator(`[data-day="${mid}"]`).getAttribute("data-tone")) === "free", "once marked returned, the scooter is open for booking again right away (times + calendar)");
  const yam = sql("select id from scooters where name = 'Yamaha Mio'");
  sql(`insert into rental_bookings (scooter_id, scooter_name, customer_name, customer_phone, start_date, end_date, pickup_at, return_at, blocked_until, days, daily_rate, total, deposit_amount, license_path, status, payment_status)
       values ('${yam}', 'Yamaha Mio', 'Late Larry', '09170000009', current_date - 2, current_date - 1, now() - interval '2 days', now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', 1, 400, 400, 120, 'licenses/x.jpg', 'picked_up', 'deposit_paid')`);
  await cust2.goto(BASE + "/baybayin");
  await setTimes(cust2, ymd(45), "10:00", ymd(46), "10:00");
  await until(async () => (await cust2.getByRole("radio", { name: "Yamaha Mio (booked)" }).count()) === 1, "overdue Yamaha unavailable");
  assert(true, "an overdue scooter (picked up, not returned) can't be booked for any date — even weeks ahead");
  sql("update rental_bookings set status = 'returned' where customer_name = 'Late Larry'");
  await cust2.reload();
  await setTimes(cust2, ymd(45), "10:00", ymd(46), "10:00");
  await until(async () => (await cust2.getByRole("radio", { name: "Yamaha Mio", exact: true }).count()) === 1, "Yamaha free after return");
  assert(true, "once the overdue scooter is marked returned, it can be booked again");
  await admin.keyboard.press("Escape");

  // ---------- staff reject a payment ----------
  await book(cust2, { scooter: "Yamaha Mio", start: ymd(10), end: ymd(10), startTime: "09:00", endTime: "17:00", name: "Ben Cruz", phone: "09181234567" });
  const no2 = await payGcash(cust2);
  await admin.getByRole("radio", { name: /GCash to check/ }).click();
  await admin.getByTestId("booking-row").filter({ hasText: no2 }).click();
  await sheet.getByText("Ben Cruz").waitFor();
  assert((await sheet.getByTestId("gcash-proof").textContent()).includes("₱120"), "same-day 8-hour rental = 1 day (₱400 → ₱120 deposit)");
  await sheet.getByRole("button", { name: "Payment not received — cancel" }).click();
  await until(() => sql(`select status||'|'||cancel_reason from rental_bookings where booking_number='${no2}'`) === "cancelled|GCash payment not received", "rejected");
  await until(() => textsTo("09181234567", /has been cancelled/).length === 1, "cancellation text");
  assert(/Reason: GCash payment not received\.$/.test(textsTo("09181234567", /cancelled/)[0].message), "rejecting cancels with 'GCash payment not received' and texts the customer (no refund mention)");
  assert((await sheet.getByText("Refund needed").count()) === 0, "a rejected (unpaid) booking needs no refund");
  await cust2.reload();
  await cust2.getByText("GCash payment not received").waitFor();
  assert(true, "customer's page shows the booking cancelled with the reason");
  await admin.keyboard.press("Escape");

  // ---------- verified, then cancelled → refund sent back by GCash ----------
  const cust3 = await (await browser.newContext(phone)).newPage();
  await book(cust3, { scooter: "Yamaha Mio", start: ymd(20), end: ymd(22), name: "Cara Lim", phone: "09191234567" });
  const no3 = await payGcash(cust3);
  await admin.getByRole("radio", { name: /GCash to check/ }).click();
  await admin.getByTestId("booking-row").filter({ hasText: no3 }).click();
  await sheet.getByRole("button", { name: "Deposit verified" }).click();
  await sheet.getByRole("button", { name: "Cancel this booking…" }).waitFor();
  await sheet.getByRole("button", { name: "Cancel this booking…" }).click();
  await sheet.getByRole("button", { name: "Customer cancelled" }).click();
  await sheet.getByRole("button", { name: "Cancel booking" }).click();
  await sheet.getByText("Refund needed").waitFor();
  assert((await sheet.textContent()).includes("Send ₱240 back to 09191234567 by GCash"), "a paid, cancelled booking tells staff to send the ₱240 back by GCash");
  await sheet.getByRole("button", { name: "Mark deposit refunded" }).click();
  await until(() => sql(`select payment_status from rental_bookings where booking_number='${no3}'`) === "refunded", "refunded");
  await until(() => textsTo("09191234567", /sent back to your GCash/).length === 1, "refund text");
  assert(true, "Mark deposit refunded → refunded, customer texted 'sent back to your GCash'");
  await sheet.getByTestId("sms-log").getByText("Deposit refunded").waitFor();
  await cust3.reload();
  await cust3.getByText("Your deposit has been sent back to you.").waitFor();
  assert(true, "customer's booking page shows cancelled + deposit sent back");
  await admin.keyboard.press("Escape");

  // ---------- extra hours + per-scooter security deposit paid now ----------
  const cust7 = await (await browser.newContext(phone)).newPage();
  await book(cust7, { scooter: "Yamaha Mio", start: ymd(50), end: ymd(51), startTime: "09:00", endTime: "12:00", name: "Gio Tan", phone: "09251234567" });
  await cust7.getByTestId("excess-hours").waitFor();
  const sum7 = await cust7.getByTestId("rental-summary").textContent();
  assert((await cust7.getByTestId("excess-hours").textContent()).includes("Extra 3 hours × ₱50") && sum7.includes("₱550"), "27 h: 1 day ₱400 + 3 extra hours × ₱50 = ₱550 total");
  assert((await yamCard(cust7).textContent()).includes("₱1,000 security deposit"), "the scooter card shows its own security deposit (Yamaha ₱1,000)");
  assert((await cust7.getByTestId("pay-now").textContent()).includes("₱165") && (await cust7.getByTestId("security-deposit").textContent()).includes("₱1,000") && (await cust7.getByTestId("due-at-pickup").textContent()).includes("₱1,385"), "unticked (default): pay ₱165 now; security ₱1,000 added to the balance at pickup (₱385 + ₱1,000 = ₱1,385)");
  await cust7.getByLabel(/Pay the ₱1,000 security deposit now/).check();
  assert((await cust7.getByTestId("pay-now").textContent()).includes("₱1,165") && (await cust7.getByTestId("due-at-pickup").textContent()).includes("₱385") && (await cust7.getByTestId("security-deposit").count()) === 0, "ticked: pay ₱165 + ₱1,000 = ₱1,165 now; only the ₱385 rental balance at pickup");
  await cust7.getByLabel("I have read and agree to the terms and conditions").check();
  assert((await cust7.getByTestId("gcash-amount").textContent()) === "₱1,165", "the GCash form asks for the ₱1,165 (deposit + security deposit)");
  const no7 = await payGcash(cust7);
  assert(sql(`select days||'|'||excess_hours||'|'||excess_fee||'|'||total||'|'||security_deposit||'|'||security_upfront||'|'||pay_now from rental_bookings where booking_number='${no7}'`) === "1|3|150.00|550.00|1000.00|true|1165.00", "saved: 1 day + 3 h (₱150), total ₱550, security ₱1,000 paid upfront, ₱1,165 paid now");
  assert((await cust7.getByTestId("paid-now").textContent()) === "₱1,165" && (await cust7.getByTestId("due-at-pickup").textContent()) === "₱385", "booking page: ₱1,165 sent; ₱385 balance at pickup");

  // ---------- online deposit (HitPay) ----------
  assert((await cust3.getByRole("radio", { name: /Pay online/ }).count()) === 0, "with online deposit off, customers only see the GCash receipt option");
  await admin.getByRole("tab", { name: "settings" }).click();
  await admin.getByRole("switch", { name: "Online deposit (HitPay)" }).click();
  await admin.getByRole("button", { name: "Save rental settings" }).click();
  await admin.getByText("Rental settings saved.").waitFor();
  assert(sql("select online_enabled::text from rental_settings") === "true", "admin switches on the online deposit (HitPay)");
  const cust5 = await (await browser.newContext(phone)).newPage();
  await book(cust5, { scooter: "Honda Click 125", start: ymd(30), end: ymd(31), name: "Eva Santos", phone: "09211234567" });
  assert((await cust5.getByRole("radio", { name: /Pay online/ }).count()) === 0, "payment choices stay hidden until the terms are agreed");
  await cust5.getByLabel("I have read and agree to the terms and conditions").check();
  await cust5.getByTestId("online-payment").waitFor();
  assert((await cust5.getByRole("radio", { name: /Pay online/ }).getAttribute("aria-checked")) === "true" && (await cust5.getByTestId("gcash-payment").count()) === 0, "after agreeing: Pay online (selected) or GCash (send manually); no receipt needed online");
  await cust5.getByRole("radio", { name: /GCash \(send manually\)/ }).click();
  await cust5.getByTestId("gcash-payment").waitFor();
  await cust5.getByRole("radio", { name: /Pay online/ }).click();
  await cust5.getByRole("button", { name: "Pay ₱150 online" }).click();
  await cust5.waitForURL(/127\.0\.0\.1:4010\/checkout\/pr_\d+/);
  assert((await cust5.locator("#amount").textContent()) === "PHP 150.00", "customer goes to HitPay for exactly the ₱150 deposit (1 day × ₱500 × 30%)");
  const no5 = await cust5.locator("#ref").textContent();
  assert(sql(`select payment_method||'|'||payment_status||'|'||(payment_expires_at is not null)||'|'||(terms_snapshot is not null) from rental_bookings where booking_number='${no5}'`) === "online|awaiting_payment|true|true", "online booking held 30 minutes while unpaid, terms recorded");
  await cust5.getByRole("button", { name: "Pay with GCash" }).click();
  await cust5.waitForURL(/\/baybayin\/booking\/[0-9a-f-]{36}\?paid=1/);
  await cust5.getByText("You're booked! Deposit received ✓").waitFor({ timeout: 15000 });
  assert(sql(`select status||'|'||payment_status from rental_bookings where booking_number='${no5}'`) === "confirmed|deposit_paid", "after paying on HitPay the booking confirms automatically (no staff check)");
  await until(() => textsTo("09211234567", /is confirmed/).length === 1, "online confirmation text");
  assert(true, "the customer gets the confirmation text right after paying online");
  await admin.getByRole("tab", { name: "bookings" }).click();
  await admin.getByRole("radio", { name: "Confirmed & on the road" }).click();
  await admin.getByTestId("booking-row").filter({ hasText: no5 }).click();
  await sheet.getByText("Eva Santos").waitFor();
  assert((await sheet.getByTestId("gcash-proof").count()) === 0 && (await sheet.textContent()).includes("Deposit (online)"), "staff see it as an online deposit (no receipt to check)");
  await sheet.getByRole("button", { name: "Cancel this booking…" }).click();
  await sheet.getByRole("button", { name: "Customer cancelled" }).click();
  await sheet.getByRole("button", { name: "Cancel booking" }).click();
  await sheet.getByRole("button", { name: "Refund ₱150 payment" }).click();
  await until(() => sql(`select payment_status from rental_bookings where booking_number='${no5}'`) === "refunded", "online refund");
  assert(hp.refunds.some((r) => r.amount === "150.00"), "cancelling an online booking refunds the deposit through HitPay");
  await admin.keyboard.press("Escape");
  const cust6 = await (await browser.newContext(phone)).newPage();
  await book(cust6, { scooter: "Yamaha Mio", start: ymd(40), end: ymd(41), name: "Fe Cruz", phone: "09221234567" });
  await cust6.getByLabel("I have read and agree to the terms and conditions").check();
  await cust6.getByRole("button", { name: "Pay ₱120 online" }).click();
  await cust6.waitForURL(/127\.0\.0\.1:4010\/checkout\/(pr_\d+)/);
  const pr6 = cust6.url().split("/").pop();
  await cust6.getByRole("link", { name: "Back to merchant" }).click();
  await cust6.getByText("Complete your deposit").waitFor({ timeout: 10000 });
  await cust6.getByRole("button", { name: "Pay ₱120 now" }).click();
  await cust6.waitForURL(new RegExp(`/checkout/${pr6}$`));
  assert(true, "leaving HitPay unpaid: the booking page offers Pay now, which resumes the same payment");
  await cust6.goBack();
  await cust6.getByText("Complete your deposit").waitFor({ timeout: 10000 });
  await cust6.getByTestId("gcash-fallback-open").click();
  assert((await cust6.getByTestId("gcash-fallback-amount").textContent()) === "₱120", "Can't pay online? shows the GCash details for the ₱120 deposit");
  await cust6.setInputFiles("input[aria-label='GCash payment screenshot']", F("test-logo.png"));
  await cust6.getByTestId("gcash-fallback").getByRole("button", { name: "Send GCash screenshot" }).click();
  await cust6.getByText("We're checking your GCash payment").first().waitFor({ timeout: 10000 });
  assert(sql("select payment_method||'|'||payment_status||'|'||(payment_proof_path like 'proofs/rentals/%')||'|'||(payment_expires_at is null) from rental_bookings where customer_name = 'Fe Cruz'") === "gcash|for_verification|true|true", "booking switched from online to GCash: receipt saved, waiting for staff, no 30-minute release");
  await until(() => textsTo("09170000001", /New booking .* Fe Cruz/).length === 1, "staff alert after switch");
  assert(true, "staff get the 'check the GCash' text for the switched booking");

  // ---------- staff calendar ----------
  await admin.getByRole("tab", { name: "calendar" }).click();
  const scal = admin.getByTestId("staff-calendar");
  await (await dayCell(admin, scal, mid)).click();
  const entry = scal.getByTestId("calendar-booking").filter({ hasText: bookingNo });
  await entry.waitFor();
  assert((await entry.textContent()).includes("Honda Click 125") && (await entry.textContent()).includes("Ana Reyes"), "staff calendar: tapping a day lists that day's bookings");
  assert((await scal.getByTestId("calendar-booking").filter({ hasText: no2 }).count()) === 0, "cancelled bookings aren't on the calendar");
  await entry.click();
  await sheet.getByText("Ana Reyes").waitFor();
  assert(true, "tapping a calendar booking opens its details");
  await admin.keyboard.press("Escape");

  // ---------- number of units ----------
  await admin.getByRole("tab", { name: "scooters" }).click();
  await admin.getByTestId("scooter-row").filter({ hasText: "Yamaha Mio" }).getByRole("button", { name: "Edit" }).click();
  await admin.locator("#scooter-units").fill("0");
  await admin.getByRole("button", { name: "Save scooter" }).click();
  await admin.getByText("Number of units must be a whole number from 1 to 50.").waitFor();
  await admin.locator("#scooter-units").fill("2");
  await admin.getByRole("button", { name: "Save scooter" }).click();
  await admin.getByText("Yamaha Mio saved.").waitFor();
  assert((await admin.getByTestId("scooter-row").filter({ hasText: "Yamaha Mio" }).textContent()).includes("2 units") && sql("select units from scooters where name = 'Yamaha Mio'") === "2", "admin sets the number of units (Yamaha × 2)");
  const yamOpt = (pg) => pg.getByTestId("scooter-option").filter({ hasText: "Yamaha Mio" });
  const u1 = await (await browser.newContext(phone)).newPage();
  await book(u1, { scooter: "Yamaha Mio", start: ymd(60), end: ymd(61), name: "Uno Uy", phone: "09231234567" });
  assert((await yamOpt(u1).textContent()).includes("2 of 2 left"), "booking page shows how many units are left (2 of 2)");
  await payGcash(u1);
  const u2 = await (await browser.newContext(phone)).newPage();
  await book(u2, { scooter: "Yamaha Mio", start: ymd(60), end: ymd(61), name: "Dos Diaz", phone: "09241234567" });
  assert((await yamOpt(u2).textContent()).includes("1 of 2 left"), "after one booking: 1 of 2 left for the same dates");
  await payGcash(u2);
  const u3 = await (await browser.newContext(phone)).newPage();
  await u3.goto(BASE + "/baybayin");
  await setTimes(u3, ymd(60), "09:00", ymd(61), "09:00");
  await until(async () => (await u3.getByRole("radio", { name: "Yamaha Mio (booked)" }).count()) === 1, "Yamaha fully booked");
  assert(true, "two customers booked both Yamaha units for the same dates; a third sees it as Booked");
  await (await dayCell(u3, u3.getByTestId("availability-calendar"), ymd(60))).waitFor();
  await u3.getByRole("radio", { name: "Honda Click 125", exact: true }).click();
  await setTimes(u3, ymd(62), "09:00", ymd(63), "09:00");
  await u3.getByRole("radio", { name: "Yamaha Mio", exact: true }).click();
  const tone60 = await (await dayCell(u3, u3.getByTestId("availability-calendar"), ymd(60))).getAttribute("aria-label");
  assert(tone60.includes("booked"), `calendar for Yamaha shows ${ymd(60)} as booked when both units are taken (${tone60})`);

  // ---------- pickup reminder (via the 10-minute tick's route) ----------
  sql("update rental_settings set open_time = '00:00', close_time = '23:30'"); // the reminder test books ~1 hour from now, whatever the time
  const cust4 = await (await browser.newContext(phone)).newPage();
  await cust4.goto(BASE + "/baybayin");
  await cust4.getByRole("heading", { name: "Rent a scooter" }).waitFor();
  // pickup at the next half hour at least 30 min from now (Manila), back 2 hours later
  const slot = new Date(Math.ceil((Date.now() + 30 * 60000) / 1800000) * 1800000);
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  const a = parts(slot), z = parts(new Date(slot.getTime() + 2 * 3600000));
  await setTimes(cust4, `${a.year}-${a.month}-${a.day}`, `${a.hour}:${a.minute}`, `${z.year}-${z.month}-${z.day}`, `${z.hour}:${z.minute}`);
  await cust4.getByRole("radio", { name: "Yamaha Mio", exact: true }).click();
  await cust4.locator("#renter-name").fill("Dino Ramos");
  await cust4.locator("#renter-phone").fill("09201234567");
  await cust4.setInputFiles("input[aria-label=\"Driver's license photo\"]", F("test-background.png"));
  await payGcash(cust4);
  sql("update rental_bookings set status = 'confirmed', payment_status = 'deposit_paid', sms_confirmed_at = now() where customer_name = 'Dino Ramos'");
  const key = sql("select value from private.app_config where key = 'cron_key'");
  const tick = (k) => fetch(BASE + "/api/rentals/reminders", { method: "POST", headers: { "x-cron-key": k } });
  assert((await tick("wrong")).status === 403, "reminder endpoint refuses calls without the database's key");
  let j = await (await tick(key)).json();
  assert(j.sent === 0 && textsTo("09201234567", /Reminder/).length === 0, "no reminder for a booking made minutes before pickup (the confirmation is enough)");
  sql("update rental_bookings set deposit_paid_at = now() - interval '2 hours' where customer_name = 'Dino Ramos'");
  j = await (await tick(key)).json();
  await until(() => textsTo("09201234567", /Reminder/).length === 1, "reminder text");
  const rem = textsTo("09201234567", /Reminder/)[0].message;
  assert(j.sent === 1 && rem.includes("pickup at") && rem.includes("Pickup: At Pahuway Cafe") && rem.includes("security deposit"), `pickup reminder sent within 3 hours of pickup: "${rem}"`);
  await tick(key);
  assert(textsTo("09201234567", /Reminder/).length === 1, "each reminder is sent once");
  sql("update rental_settings set open_time = '08:00', close_time = '22:00'");

  // ---------- terms removed or switch off → Coming soon ----------
  sql("update rental_settings set terms = '  ' where id = 1");
  await cust.goto(BASE + "/baybayin");
  await cust.getByText("Coming soon").first().waitFor();
  assert(true, "with the switch on but no terms, the Baybayin page shows Coming soon");
  sql(`update rental_settings set terms = '${TERMS.replace(/'/g, "''")}' where id = 1`);
  await admin.getByRole("tab", { name: "settings" }).click();
  await admin.getByRole("switch", { name: "Accept bookings" }).click();
  await admin.getByRole("button", { name: "Save rental settings" }).click();
  await admin.getByText("Rental settings saved.").waitFor();
  await cust.goto(BASE + "/baybayin");
  await cust.getByText("Coming soon").first().waitFor();
  assert(true, "switching bookings off shows Coming soon again");
  assert(sql(`select count(*) from rental_bookings where booking_number = '${bookingNo}' and terms_snapshot like '%non-refundable for no-shows%'`) === "1", "bookings keep the terms they were made under");

  await browser.close();
  sms.server.close();
  hp.server.close();
  sql("delete from rental_bookings; delete from scooters; update rental_settings set bookings_enabled = false, terms = null, online_enabled = false, messenger_url = null, open_time = '08:00', close_time = '22:00';");
  console.log("\nAll rental checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
