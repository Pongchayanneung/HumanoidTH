import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { businessSnapshot, browserOrigin, databaseUrl, openSql, operatorEmail, operatorPassword, type SqlClient } from "../test-integration/fixture";

let sql: SqlClient;
let initialBusiness: string;
const denied = { ok: false, code: "WORKFLOW_UNAVAILABLE" };

async function signIn(page: Page, password = operatorPassword) {
  await page.goto("/admin-login?from=https://untrusted.invalid/path");
  await page.getByLabel("Email address", { exact: true }).fill(operatorEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function sessionCookie(context: BrowserContext) {
  const cookies = (await context.cookies()).filter(cookie => cookie.name.includes("operator_session"));
  expect(cookies.length).toBe(1);
  return cookies[0];
}
async function attemptState() {
  return (await sql.query('SELECT "activeFingerprint", "attemptCount", "windowStartedAt" FROM "OperatorAuthState"')).rows;
}

test.beforeAll(async () => {
  const name = process.env.ISSUE4_BROWSER_DATABASE_NAME;
  if (!name) throw new Error("Run this suite using playwright.auth.config.ts and its dedicated server");
  sql = await openSql(databaseUrl(name));
  initialBusiness = await businessSnapshot(sql);
});
test.beforeEach(async () => {
  // Only this server's uniquely named scratch DB is reset between browser cases.
  await sql.query('DELETE FROM "OperatorSession"');
  await sql.query('UPDATE "OperatorAuthState" SET "attemptCount" = 0, "windowStartedAt" = (clock_timestamp() AT TIME ZONE \'UTC\')');
});
test.afterAll(async () => {
  try { if (sql) expect(await businessSnapshot(sql)).toBe(initialBusiness); }
  finally { await sql?.end(); }
});

test("anonymous and forged legacy identities cannot open the administrator landing", async ({ page, context }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin-login$/);
  await context.addCookies([
    { name: "admin_session", value: "true", url: browserOrigin },
    { name: "user_role", value: "ADMIN", url: browserOrigin },
    { name: "user_email", value: operatorEmail, url: browserOrigin },
    { name: "operator_session_dev", value: "0".repeat(64), url: browserOrigin }
  ]);
  await page.goto("/admin?collection=users&selectedId=forged");
  await expect(page).toHaveURL(/\/admin-login$/);
  await expect(page.getByRole("heading", { name: "Operator sign-in", exact: true })).toBeVisible();
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Workflow unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Login as Administrator/i })).toHaveCount(0);
  await expect(page.locator("input, table")).toHaveCount(0);
});

test("real whitespace-preserving login creates independent browser sessions and logout invalidates copied replay", async ({ page, context, browser }) => {
  await context.addCookies([
    { name: "admin_session", value: "true", url: browserOrigin },
    { name: "user_role", value: "ADMIN", url: browserOrigin },
    { name: "user_email", value: operatorEmail, url: browserOrigin }
  ]);
  await signIn(page);
  await expect(page).toHaveURL(`${browserOrigin}/admin`);
  await expect(page.getByRole("heading", { name: "Verified session", exact: true })).toBeVisible();
  const first = await sessionCookie(context);
  expect(first.name).toBe("operator_session_dev");
  expect(first.httpOnly).toBe(true);
  expect(first.sameSite).toBe("Strict");
  expect(first.path).toBe("/");
  expect(first.secure).toBe(false);
  expect(first.expires - Date.now() / 1000).toBeGreaterThan(14_350);
  expect(first.expires - Date.now() / 1000).toBeLessThanOrEqual(14_400);
  expect((await context.cookies()).some(cookie => ["admin_session", "user_email", "user_role"].includes(cookie.name))).toBe(false);
  expect((await page.content()).includes(first.value)).toBe(false);
  expect((await page.evaluate(() => document.cookie)).includes(first.value)).toBe(false);
  await expect(page.locator("input:not([type=hidden]), table")).toHaveCount(0);
  const secondContext = await browser.newContext({ baseURL: browserOrigin });
  const replayContext = await browser.newContext({ baseURL: browserOrigin });
  try {
    const secondPage = await secondContext.newPage();
    await signIn(secondPage);
    await expect(secondPage).toHaveURL(`${browserOrigin}/admin`);
    const second = await sessionCookie(secondContext);
    expect(first.value === second.value).toBe(false);
    await replayContext.addCookies([first]);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/admin-login$/);
    expect((await context.cookies()).some(cookie => cookie.name === first.name)).toBe(false);
    const replayPage = await replayContext.newPage();
    await replayPage.goto("/admin");
    await expect(replayPage).toHaveURL(/\/admin-login$/);
    await secondPage.reload();
    await expect(secondPage.getByRole("heading", { name: "Verified session", exact: true })).toBeVisible();
  } finally { await secondContext.close(); await replayContext.close(); }
});

test("unknown email and incorrect password show the same generic error and attempts throttle globally", async ({ page }) => {
  for (let index = 0; index < 5; index++) {
    await page.goto("/admin-login");
    await page.getByLabel("Email address", { exact: true }).fill(index % 2 ? "unknown@example.invalid" : operatorEmail);
    await page.getByLabel("Password", { exact: true }).fill(index % 2 ? operatorPassword : operatorPassword.trim());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/error=invalid_credentials$/);
    await expect(page.locator("#login-error")).toHaveText("Email or password is incorrect.");
  }
  await signIn(page);
  await expect(page).toHaveURL(/error=throttled$/);
  await expect(page.locator("#login-error")).toHaveText("Too many sign-in attempts. Please try again later.");
  expect((await attemptState())[0].attemptCount).toBe(5);
});

test("actual login action transport rejects absent and foreign Origin without spending quota or setting sessions", async ({ page, request }) => {
  let captured: { action: string; contentType: string; body: Buffer } | undefined;
  page.on("request", event => {
    const action = event.headers()["next-action"];
    const body = event.postDataBuffer();
    if (event.method() === "POST" && action && body) captured = { action, contentType: event.headers()["content-type"], body };
  });
  await signIn(page);
  await expect(page).toHaveURL(`${browserOrigin}/admin`);
  expect(Boolean(captured)).toBe(true);
  const state = await attemptState();
  const sessions = (await sql.query('SELECT "tokenHash" FROM "OperatorSession"')).rows;
  for (const origin of [undefined, "https://untrusted.invalid"]) {
    const response = await request.post("/admin-login", {
      headers: { "next-action": captured!.action, "content-type": captured!.contentType, ...(origin ? { Origin: origin } : {}) },
      data: captured!.body,
      maxRedirects: 0
    });
    // Next's own CSRF gate may reject foreign Origin before the adapter executes.
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThanOrEqual(500);
    expect(response.headersArray().some(header => header.name.toLowerCase() === "set-cookie" && header.value.includes("operator_session"))).toBe(false);
  }
  expect(await attemptState()).toEqual(state);
  expect((await sql.query('SELECT "tokenHash" FROM "OperatorSession"')).rows).toEqual(sessions);
});

test("disabled API transport rejects malformed bodies and legacy Basic authority even for an operator", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(`${browserOrigin}/admin`);
  const request = page.request;
  for (const table of ["submissions", "pull_jobs", "sources", "robots", "../users"]) {
    const response = await request.get(`/api/export?table=${encodeURIComponent(table)}`, { headers: { Authorization: `Basic ${Buffer.from("synthetic:synthetic").toString("base64")}` } });
    expect(response.status()).toBe(403);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual(denied);
    expect(response.headers()["content-disposition"]).toBeUndefined();
    expect(response.headers()["www-authenticate"]).toBeUndefined();
  }
  for (const adapter of ["openalex", "github", "unknown"]) {
    const response = await request.post(`/api/ingest/${adapter}`, { headers: { "Content-Type": "application/json" }, data: "{malformed-json" });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual(denied);
  }
});

test("expiry is enforced on the next administrator request", async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL(`${browserOrigin}/admin`);
  await sessionCookie(context);
  await sql.query('UPDATE "OperatorSession" SET "expiresAt" = (clock_timestamp() AT TIME ZONE \'UTC\') - interval \'1 millisecond\'');
  await page.reload();
  await expect(page).toHaveURL(/\/admin-login$/);
});

test("failed session revocation retains the cookie and permits a later successful retry", async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL(`${browserOrigin}/admin`);
  const cookie = await sessionCookie(context);
  await sql.query('ALTER TABLE "OperatorSession" RENAME TO "OperatorSession_acceptance_offline"');
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?error=unavailable$/);
    await expect(page.getByRole("heading", { name: "Authentication unavailable", exact: true })).toBeVisible();
    const retained = await sessionCookie(context);
    expect(retained.value === cookie.value).toBe(true);
  } finally { await sql.query('ALTER TABLE "OperatorSession_acceptance_offline" RENAME TO "OperatorSession"'); }
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Verified session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/admin-login$/);
});

test("unavailable pages and language switching work publicly at desktop and mobile widths", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/profile", "/submit-data", "/data-pulls", "/map"]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Workflow unavailable", exact: true })).toBeVisible();
      await expect(page.locator("input, table, form")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/profile");
  await page.getByRole("button", { name: "ภาษาไทย", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { name: "ยังไม่เปิดให้ใช้งาน", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Workflow unavailable", exact: true })).toBeVisible();
});

test("login handles inherited error keys and remains usable on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const error of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const response = await page.goto(`/admin-login?error=${encodeURIComponent(error)}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("#login-error")).toHaveText("Sign-in is unavailable right now. Please try again later.");
  }
  await page.goto("/admin-login");
  await expect(page.getByRole("heading", { name: "Operator sign-in", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("synthetic mobile toggle input");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("synthetic mobile toggle input");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await password.clear();
  await page.locator(".splash-screen").waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Operator sign-in", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("operator-login-mobile.png") });
});
