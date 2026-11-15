// Customer sign-up with the email optional: no email → the account signs in with the mobile number.
// Start the app (npx next start -p 3000) with the local Supabase stack and run: npm run test:account
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_pahuway-cafe", "psql", "-U", "postgres", "-Atc", q]).toString().trim();
const assert = (c, m) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("ok", m);
};

(async () => {
  sql("delete from auth.users where email in ('09175550101@phone.invalid', 'lea.test@example.com')");
  const browser = await chromium.launch();
  const page = await (await browser.newContext(devices["iPhone 13"])).newPage();
  const openSignup = async () => {
    await page.goto(BASE + "/account");
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.locator("#su-name").waitFor();
  };

  // ---- sign up without an email
  await openSignup();
  assert((await page.locator("label[for=a-email]").textContent()).includes("(optional)"), "sign-up form marks the email as optional");
  await page.locator("#su-name").fill("Lea Santos");
  await page.locator("#su-phone").fill("0917 555 0101");
  await page.locator("#a-pass").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Password must be at least 8 characters.").waitFor();
  await page.locator("#a-email").fill("lea@nodot");
  await page.locator("#a-pass").fill("Kape-sa-umaga-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Please check your email address, or leave it empty.").waitFor();
  await page.locator("#a-email").fill("");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Hi, Lea!" }).waitFor();
  assert((await page.getByText("Signs in with 09175550101").count()) === 1, "no email: account created and signed in; profile shows it signs in with the mobile number");
  assert(sql("select (email_confirmed_at is not null)::text from auth.users where email = '09175550101@phone.invalid'") === "true", "the account is ready to use (no email confirmation needed)");
  assert(sql("select u.full_name || '|' || u.phone from public.users u join auth.users a on a.id = u.id where a.email = '09175550101@phone.invalid'") === "Lea Santos|09175550101", "name and mobile number are saved on the profile");

  // ---- sign out, sign back in with the mobile number
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/");
  await page.goto(BASE + "/account");
  assert((await page.locator("label[for=a-email]").textContent()).trim() === "Email or mobile number", "sign-in accepts an email or a mobile number");
  await page.locator("#a-email").fill("09175550101");
  await page.locator("#a-pass").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByText("Wrong mobile number or password.").waitFor();
  await page.locator("#a-email").fill("0917 555 0101");
  await page.locator("#a-pass").fill("Kape-sa-umaga-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByRole("heading", { name: "Hi, Lea!" }).waitFor();
  assert(true, "signs in with mobile number + password");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/");

  // ---- the same mobile number can't sign up twice
  await openSignup();
  await page.locator("#su-name").fill("Lea Again");
  await page.locator("#su-phone").fill("09175550101");
  await page.locator("#a-pass").fill("Another-pass-22");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("An account with this mobile number already exists. Please sign in instead.").waitFor();
  assert(true, "a mobile number can only have one email-less account");

  // ---- sign up with an email still works as before
  await page.locator("#su-name").fill("Lea Email");
  await page.locator("#su-phone").fill("09175550102");
  await page.locator("#a-email").fill("lea.test@example.com");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForFunction(() => /Hi, Lea!|Check your email/.test(document.body.innerText), null, { timeout: 10000 });
  assert(sql("select count(*) from auth.users where email = 'lea.test@example.com'") === "1", "signing up with an email still works as before");

  // ---- forgot password (email account): reset link by email → choose a new password
  const lea2 = page; // still signed in as Lea Email (or waiting for confirmation) — sign out first
  await lea2.goto(BASE + "/account");
  await lea2.waitForFunction(() => /Hi, Lea!|Forgot password\?/.test(document.body.innerText));
  if (await lea2.getByRole("button", { name: "Sign out" }).count()) {
    await lea2.getByRole("button", { name: "Sign out" }).click();
    await lea2.waitForURL(BASE + "/");
    await lea2.goto(BASE + "/account");
  }
  await fetch("http://127.0.0.1:54324/api/v1/messages", { method: "DELETE" });
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByTestId("forgot-password").waitFor();
  await page.locator("#reset-id").fill("lea.test@example.com");
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByText("we've sent a link to set a new password").waitFor();
  let link = null;
  for (let i = 0; i < 40 && !link; i++) {
    const list = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json();
    const m = list.messages?.find((x) => x.To?.some((t) => t.Address === "lea.test@example.com"));
    if (m) {
      const full = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${m.ID}`)).json();
      link = ((full.HTML || full.Text || "").match(/https?:\/\/[^"'\s<>]+verify[^"'\s<>]+/) || [])[0]?.replace(/&amp;/g, "&");
    }
    if (!link) await new Promise((r) => setTimeout(r, 250));
  }
  assert(!!link, "Forgot password? sends a reset email to an email account");
  await page.goto(link);
  await page.getByRole("heading", { name: "Choose a new password" }).waitFor();
  await page.locator("#new-password").fill("Bagong-pass-2026");
  await page.locator("#confirm-password").fill("Bagong-pass-2026");
  await page.getByRole("button", { name: "Save password and continue" }).click();
  await page.waitForURL(BASE + "/account");
  await page.getByRole("heading", { name: "Hi, Lea!" }).waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/");
  await page.goto(BASE + "/account");
  await page.locator("#a-email").fill("lea.test@example.com");
  await page.locator("#a-pass").fill("Bagong-pass-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByRole("heading", { name: "Hi, Lea!" }).waitFor();
  assert(true, "the reset link lets the customer choose a new password and sign in with it");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/");

  // ---- forgot password (mobile-number account): reset by the café
  await page.goto(BASE + "/account");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.locator("#reset-id").fill("09175550101");
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByTestId("phone-reset-help").waitFor();
  assert((await page.getByTestId("phone-reset-help").textContent()).includes("temporary password"), "mobile-number accounts are told the café can give them a temporary password");

  // ---- admin resets it: temporary password → customer signs in → changes it
  const admin = await (await browser.newContext(devices["iPad (gen 7) landscape"])).newPage();
  admin.on("dialog", (d) => d.accept());
  await admin.goto(BASE + "/login");
  await admin.fill("#email", "admin@pahuway.cafe");
  await admin.fill("#password", "ChangeMe-Admin-2026");
  await admin.click("button:has-text('Sign in')");
  await admin.waitForURL(BASE + "/admin");
  await admin.goto(BASE + "/admin/settings");
  const box = admin.getByTestId("customer-password-reset");
  await box.locator("#cust-reset-phone").fill("09179999999");
  await box.getByRole("button", { name: "Reset password" }).click();
  await box.getByText("No customer account signs in with 09179999999").waitFor();
  await box.locator("#cust-reset-phone").fill("0917 555 0101");
  await box.getByRole("button", { name: "Reset password" }).click();
  const temp = (await box.getByTestId("temp-password").textContent()).trim();
  assert(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp), `admin gets a temporary password for the customer (${temp})`);
  await page.goto(BASE + "/account");
  await page.locator("#a-email").fill("09175550101");
  await page.locator("#a-pass").fill("Kape-sa-umaga-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByText("Wrong mobile number or password.").waitFor();
  await page.locator("#a-pass").fill(temp);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByRole("heading", { name: "Hi, Lea!" }).waitFor();
  assert(true, "the old password stops working; the customer signs in with the temporary one");
  const cp = page.getByTestId("change-password");
  await cp.locator("#cp-new").fill("Sariling-pass-99");
  await cp.locator("#cp-again").fill("Sariling-pass-98");
  await cp.getByRole("button", { name: "Change password" }).click();
  await cp.getByText("The two passwords don't match.").waitFor();
  await cp.locator("#cp-again").fill("Sariling-pass-99");
  await cp.getByRole("button", { name: "Change password" }).click();
  await cp.getByText("Password changed.").waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/");
  await page.goto(BASE + "/account");
  await page.locator("#a-email").fill("09175550101");
  await page.locator("#a-pass").fill("Sariling-pass-99");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByRole("heading", { name: "Hi, Lea!" }).waitFor();
  assert(true, "the customer changes the temporary password in their account and signs in with the new one");
  await page.goto(BASE + "/");
  await page.getByTestId("hero-eyebrow").getByText("👋 Welcome, Lea!").waitFor();
  assert(true, "signed in: the home page greets the customer by first name (👋 Welcome, Lea! above the title)");
  await page.goto(BASE + "/menu");
  await page.waitForFunction(() => /Welcome, Lea!/.test(document.querySelector("[data-testid=menu-greeting]")?.textContent?.replace(/\s+/g, " ") ?? ""));
  assert(true, "signed in: the café menu headline says Welcome, Lea!");
  await page.goto(BASE + "/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(BASE + "/");
  await page.getByTestId("welcome-title").getByText("Book all of Romblon in one place.", { exact: true }).waitFor();
  assert(true, "signed out: the normal welcome title is back");
  await page.goto(BASE + "/menu");
  await page.waitForFunction(() => /Welcome, guest!/.test(document.querySelector("[data-testid=menu-greeting]")?.textContent?.replace(/\s+/g, " ") ?? ""));
  assert(true, "signed out: the café menu headline says Welcome, guest!");
  const bayTitle = await (await fetch(BASE + "/baybayin")).text();
  assert(/<title>Baybayin scooter rental — Book now<\/title>/.test(bayTitle), "Baybayin page title says Book now");

  // ---- the server route refuses bad input
  const r = await fetch(BASE + "/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X", phone: "123", password: "x" }) });
  assert(r.status === 400, "sign-up route checks name, mobile number and password");

  await browser.close();
  sql("delete from auth.users where email in ('09175550101@phone.invalid', 'lea.test@example.com')");
  console.log("\nAll account checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
