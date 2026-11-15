// Padaya 2.0 hub (Phase 1): search, category pills and tiles, listing rows, Explore (filters, coming soon, Saved),
// favourites (♡), deep links into the menu item and the scooter booking form, Explore in the footer.
// Needs local Supabase (migrations + seed) + seed:users + app on :3000.  Run: npm run test:hub
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};
const PHONE = "09175550144";
const PASS = "Kape-sa-umaga-1";

(async () => {
  sql(`delete from auth.users where email = '${PHONE}@phone.invalid'`);
  sql("update store_settings set is_open = true, open_time = '00:00', close_time = '23:59', welcome_banner_color = null");
  sql("update rental_settings set bookings_enabled = true, terms = coalesce(nullif(terms, ''), 'Test terms.')");
  sql("update stay_settings set bookings_enabled = false"); // Stays stay "Soon" here; stays have their own test
  sql("update scooters set is_active = false where vehicle_type = 'car'"); // Cars stay "Soon" here; the car flow has its own test
  sql("insert into scooters (name, daily_rate, is_active) select 'Hub Scooter', 650, true where not exists (select 1 from scooters where is_active and vehicle_type = 'scooter')");
  const res = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hana Hub", phone: PHONE, password: PASS }) });
  assert(res.ok, "test customer created");
  assert(sql("select string_agg(slug, ',' order by slug) from businesses") === "baybayin,padaya-stays,padaya-tours,pahuway-cafe" && sql("select count(*) from scooters where business_id is null") === "0", "businesses: Pahuway Cafe, Baybayin, Padaya Stays and Padaya Tours; every scooter belongs to Baybayin");

  const browser = await chromium.launch();
  try {
    const g = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await g.goto(BASE + "/");
    await g.getByTestId("row-food").waitFor();

    // ---- home: search, pills, tiles, rows
    assert((await g.getByTestId("hub-search").getByRole("searchbox").count()) + (await g.getByLabel("Search Padaya").count()) >= 1, "home has a search box for food, scooters, cars or stays");
    const cats = (await g.getByTestId("home-categories").getByRole("link").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    assert(cats.length === 4 && /Stays .*Coming soon/i.test(cats[0]) && /Rentals/.test(cats[1]) && /Food delivery/.test(cats[2]) && /Tours .*Coming soon/i.test(cats[3]), `category cards: Stays (Coming soon), Rentals, Food delivery, Tours (Coming soon) (${cats.join(" / ")})`);
    const minFood = Number(sql("select min(price) from menu_items where is_active and not is_sold_out"));
    assert((await g.getByTestId("cat-food").innerText()).includes("1 store") && (await g.getByTestId("cat-rentals").innerText()).includes("1 shop"), "Food delivery: 1 store; Rentals: 1 shop");
    // ---- island / town filter (everything is in San Agustin, Tablas for now)
    assert((await g.getByTestId("island-tablas").innerText()).includes("listings") && /coming soon/i.test(await g.getByTestId("island-sibuyan").innerText()), "Explore by island: Tablas shows its listings; Sibuyan is coming soon");
    await g.getByTestId("loc-sibuyan").click();
    await g.getByTestId("loc-empty").getByText("Nothing is listed in Sibuyan yet.").waitFor();
    assert((await g.getByTestId("town-bar").getByRole("radio").allInnerTexts()).join("|") === "All towns|Cajidiocan|Magdiwang|San Fernando" && (await g.getByTestId("row-food").count()) === 0, "picking Sibuyan shows its towns and hides listings from other islands");
    await g.reload();
    await g.getByTestId("loc-empty").waitFor();
    assert((await g.getByTestId("loc-sibuyan").getAttribute("aria-checked")) === "true", "the chosen island is remembered on this phone");
    await g.getByTestId("loc-empty").getByRole("button", { name: "Show all of Romblon" }).click();
    await g.getByTestId("row-food").waitFor();
    await g.getByTestId("island-tablas").click();
    await g.getByTestId("town-bar").getByRole("radio", { name: "San Agustin" }).click();
    await g.getByTestId("row-food").waitFor();
    assert((await g.getByTestId("loc-tablas").getAttribute("aria-checked")) === "true" && (await g.getByTestId("our-brands").innerText()).includes("San Agustin"), "tapping the Tablas card filters to Tablas; San Agustin shows its brands and listings");
    await g.getByTestId("loc-all").click();
    const card = g.getByTestId("row-food").getByTestId("listing-card").first();
    assert(/₱\d/.test(await card.innerText()) && (await card.innerText()).includes("Pahuway Cafe"), "menu listing card shows name, category · Pahuway Cafe and price");

    // ---- search → Explore
    await g.getByLabel("Search Padaya").fill("americano");
    await g.getByRole("button", { name: "Search" }).click();
    await g.waitForURL(BASE + "/explore?q=americano");
    await g.getByTestId("results").waitFor();
    const titles = await g.getByTestId("results").getByTestId("listing-card").locator("p.font-bold").allInnerTexts();
    assert(titles.length >= 1 && titles.every((t) => /americano/i.test(t)), `search finds Americano only (${titles.join(", ")})`);
    await g.getByLabel("Search Padaya").fill("scooter");
    await g.getByRole("button", { name: "Search" }).click();
    await g.waitForURL(BASE + "/explore?q=scooter");
    await g.getByTestId("results").waitFor();
    const kinds = await g.getByTestId("results").getByTestId("listing-card").evaluateAll((els) => [...new Set(els.map((e) => e.dataset.kind))]);
    assert(kinds.join() === "scooter", "searching 'scooter' shows the scooters");
    await g.getByTestId("filter-rentals").click();
    await g.getByTestId("rental-types").waitFor();
    await g.getByTestId("type-cars").click();
    await g.getByTestId("coming-soon").waitFor();
    assert((await g.getByTestId("coming-soon").innerText()).includes("Car rentals are coming soon"), "Vehicle Rentals → Car rentals: coming soon page");
    await g.getByTestId("type-scooters").click();
    await g.getByTestId("results").waitFor();
    assert((await g.getByTestId("results").getByTestId("listing-card").evaluateAll((els) => [...new Set(els.map((e) => e.dataset.kind))])).join() === "scooter", "Vehicle Rentals → Scooters lists the scooters");
    await g.goto(BASE + "/explore?cat=tours");
    await g.getByTestId("coming-soon").getByText("Tours are coming soon").waitFor();
    assert(true, "Tours: coming soon page");
    await g.goto(BASE + "/explore?cat=food");
    await g.getByTestId("results").waitFor();
    const nFood = Number(sql("select count(*) from menu_items where is_active"));
    assert((await g.getByTestId("results").getByTestId("listing-card").count()) === nFood, `Food filter lists the whole menu (${nFood})`);
    assert((await g.getByTestId("nav-food").getAttribute("aria-current")) === "page", "Explore → Food highlights the Food footer tab");
    assert(minFood > 0, "menu has prices");

    // ---- guest ♡ → sign in; Saved needs sign-in
    await g.getByTestId("results").getByTestId("fav-button").first().click();
    await g.waitForURL(/\/account\?next=/);
    assert(true, "a guest tapping ♡ is asked to sign in");
    await g.goto(BASE + "/explore?cat=saved");
    await g.getByTestId("saved-signin").waitFor();
    assert(true, "Saved asks guests to sign in");

    // ---- signed in: save, see in Saved, unsave
    const c = await (await browser.newContext(devices["iPhone 13"])).newPage();
    await c.goto(BASE + "/account");
    await c.locator("#a-email").fill(PHONE);
    await c.locator("#a-pass").fill(PASS);
    await c.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await c.getByTestId("my-info").waitFor();
    await c.goto(BASE + "/");
    const sc = c.getByTestId("row-rentals").getByTestId("listing-card").first();
    await sc.waitFor();
    const scTitle = await sc.locator("p.font-bold").innerText();
    await sc.getByTestId("fav-button").click();
    await c.waitForFunction(() => document.querySelector("[data-testid=row-rentals] [data-testid=fav-button]")?.getAttribute("aria-pressed") === "true");
    assert(sql(`select count(*) from favourites f join auth.users a on a.id = f.user_id where a.email = '${PHONE}@phone.invalid' and f.kind = 'scooter'`) === "1", "♡ saves the scooter to the customer's favourites");
    await c.goto(BASE + "/explore?cat=saved");
    await c.getByTestId("results").waitFor();
    assert((await c.getByTestId("results").getByTestId("listing-card").locator("p.font-bold").allInnerTexts()).join() === scTitle, "Saved lists it");
    await c.getByTestId("results").getByTestId("fav-button").first().click();
    await c.getByTestId("no-results").waitFor();
    assert(sql(`select count(*) from favourites f join auth.users a on a.id = f.user_id where a.email = '${PHONE}@phone.invalid'`) === "0", "tapping ♡ again removes it");

    // ---- deep links
    const item = sql("select id || '|' || name from menu_items where is_active and not is_sold_out order by sort_order, name limit 1").split("|");
    await c.goto(BASE + "/menu?item=" + item[0]);
    await c.getByRole("dialog").getByText(item[1]).first().waitFor({ timeout: 10000 });
    assert(true, "a menu card opens that item straight away on the menu");
    const scooter = sql("select id from scooters where is_active order by sort_order, name limit 1");
    await c.goto(BASE + "/baybayin?scooter=" + scooter);
    await c.waitForFunction((id) => document.querySelector(`[role=radio][aria-checked=true]`)?.closest("[data-scooter]")?.getAttribute("data-scooter") === id || [...document.querySelectorAll("[role=radio][aria-checked=true]")].some((r) => r.textContent.trim().length > 0), scooter, { timeout: 10000 });
    const picked = await c.locator("[role=radio][aria-checked=true]").allInnerTexts();
    const scooterName = sql(`select name from scooters where id = '${scooter}'`);
    assert(picked.some((t) => t.includes(scooterName)), `a scooter card opens the booking form with ${scooterName} pre-selected`);
    console.log("ALL HUB CHECKS PASSED");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
