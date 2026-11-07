import { createHash } from "node:crypto";
import {
  test, expect, type APIRequestContext, type APIResponse, type BrowserContext, type Page
} from "@playwright/test";
import { PrismaClient } from "../generated/prisma/index.js";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { hashOperatorPassword } from "../lib/operator-auth/credentials";
import { createPostgresAuthStore } from "../lib/operator-auth/postgres-store";
import {
  collections, createdAt, excluded, hostileText, hostileUrl, inspectionEnvironment, inspectionOrigin, oldestId, updatedAt
} from "../test-integration/admin-inspection-fixture";
import { businessSnapshot, databaseUrl, openSql, operatorEmail, operatorPassword, type SqlClient } from "../test-integration/fixture";

const selected = (path: string, collection: string, id = oldestId) =>
  `${path}?${new URLSearchParams({ collection, selectedId: id })}`;
const submitted = (id = oldestId) => `/admin/submitted-data?${new URLSearchParams({ selectedId: id })}`;
const selectedRecord = (page: Page) => page.getByRole("region", { name: "Selected record", exact: true });
const source = collections[0];
const inspectionPaths = [selected("/admin", source.name), selected("/admin/cms", source.name), submitted()];
const invalid = /Invalid selection/;
const missing = /Record not found/;
const unavailable = /Inspection unavailable/;
let sql: SqlClient;
let url: string;
let beforeBusiness: string;

async function signIn(page: Page) {
  await page.goto("/admin-login");
  await page.getByLabel("Email address", { exact: true }).fill(operatorEmail);
  await page.getByLabel("Password", { exact: true }).fill(operatorPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verified session", exact: true })).toBeVisible();
}

async function sessionCookie(context: BrowserContext) {
  const cookie = (await context.cookies(inspectionOrigin)).find(item => item.name === "operator_session_dev");
  if (!cookie) throw new Error("Expected the real login to create a test session");
  return cookie;
}

function expectNoSharedCache(response: { headers(): Record<string, string> }) {
  const policy = response.headers()["cache-control"];
  expect(policy).toMatch(/(?:^|,\s*)no-store(?:,|$)/i);
  expect(policy).not.toMatch(/(?:^|,\s*)(?:public|s-maxage)(?:[=,]|$)/i);
}

async function responseContainsOnlyProjection(response: APIResponse, expectedTitle: string, cookieValue: string) {
  expect(response.status()).toBe(200);
  expectNoSharedCache(response);
  const body = await response.text();
  expect(body.includes(expectedTitle)).toBe(true);
  for (const sentinel of Object.values(excluded)) expect(body).not.toContain(sentinel);
  expect(body.includes(cookieValue)).toBe(false);
}

async function expectDenied(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(new URL(response.url()).pathname).toBe("/admin-login");
  const body = await response.text();
  for (const { title } of collections) expect(body).not.toContain(title);
  const flight = await request.get(path, { headers: { RSC: "1" }, maxRedirects: 0 });
  const flightBody = await flight.text();
  for (const { title } of collections) expect(flightBody).not.toContain(title);
  expect((flight.headers()["location"] ?? "") + flightBody).toContain("/admin-login");
}

test.beforeAll(async () => {
  const name = process.env.ISSUE8_BROWSER_DATABASE_NAME;
  if (!name?.startsWith("hri_issue4_acceptance_inspect_")) {
    throw new Error("Run this suite with playwright.inspection.config.ts");
  }
  url = databaseUrl(name);
  sql = await openSql(url);
  beforeBusiness = await businessSnapshot(sql);
});

test.beforeEach(async () => {
  await sql.query('DELETE FROM "OperatorSession"');
  await sql.query('UPDATE "OperatorAuthState" SET "attemptCount" = 0');
});

test.afterAll(async () => {
  try {
    if (sql) expect(await businessSnapshot(sql)).toBe(beforeBusiness);
  } finally {
    await sql?.end();
  }
});

test("the operator GET form and both aliases select the exact oldest of 101 records by collection", async ({ page, context }) => {
  await signIn(page);
  const selector = page.getByRole("region", { name: "Read-only record inspection", exact: true });
  await expect(selectedRecord(page)).toHaveCount(0);
  await expect(selector.locator('form[method="get"]')).toHaveAttribute("action", "/admin");
  await selector.getByLabel("Collection", { exact: true }).selectOption(source.name);
  await selector.getByLabel("Record ID", { exact: true }).fill(oldestId);
  await selector.getByLabel("Record ID", { exact: true }).press("Enter");
  await expect(selectedRecord(page)).toContainText(source.title);
  const query = new URL(page.url()).searchParams;
  expect([...query]).toEqual([["collection", source.name], ["selectedId", oldestId]]);
  const cookie = await sessionCookie(context);

  for (const item of collections) {
    const path = item.name === "submitted-data" ? submitted() : selected("/admin/cms", item.name);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expectNoSharedCache(response!);
    const record = selectedRecord(page);
    await expect(record).toContainText(item.title);
    await expect(record).toContainText(item.status);
    await expect(record).toContainText(createdAt);
    await expect(record).toContainText(updatedAt);
    expect(await record.getByText(oldestId.trim(), { exact: true }).textContent()).toBe(oldestId);
    for (const other of collections) {
      if (other !== item) await expect(record).not.toContainText(other.title);
    }
    await responseContainsOnlyProjection(await context.request.get(path), item.title, cookie.value);
    const flight = await context.request.get(path, { headers: { RSC: "1" } });
    expect(flight.headers()["content-type"]).toContain("text/x-component");
    await responseContainsOnlyProjection(flight, item.title, cookie.value);
  }
});

test("real route selectors reject malformed values and never substitute missing, deleted or wrong-kind records", async ({ page }) => {
  await signIn(page);
  for (const [index, item] of collections.entries()) {
    const wrongKind = collections[(index + 1) % collections.length];
    for (const id of ["not-in-inspection-fixture", `${item.name}-102`, `${wrongKind.name}-2`, oldestId.trim(), oldestId.toLowerCase()]) {
      const path = item.name === "submitted-data" ? submitted(id) : selected("/admin/cms", item.name, id);
      await page.goto(path);
      await expect(page.locator("#inspection-error")).toHaveText(missing);
      await expect(selectedRecord(page)).toHaveCount(0);
    }
  }
  const duplicate = `&selectedId=${encodeURIComponent(oldestId)}`;
  for (const path of [
    "/admin?collection=source-records",
    "/admin?selectedId=source-records-2",
    ...["", "new", "  ", "ก".repeat(86), "embedded\x00control", "embedded\x7fcontrol"]
      .map(id => selected("/admin", source.name, id)),
    ...["__proto__", "constructor", "toString", "users"].map(key => selected("/admin/cms", key)),
    selected("/admin/cms", source.name) + "&collection=source-records",
    selected("/admin", source.name) + duplicate,
    submitted() + duplicate,
    submitted() + "&collection=submitted-data&collection=submitted-data",
    selected("/admin/submitted-data", source.name)
  ]) {
    await page.goto(path);
    await expect(page.locator("#inspection-error")).toHaveText(invalid);
    await expect(selectedRecord(page)).toHaveCount(0);
  }
});

test("a business table error produces unavailable, omits SQL details, and recovers after restoration", async ({ page, context }) => {
  await signIn(page);
  const path = inspectionPaths[0];
  await page.goto(path);
  await expect(selectedRecord(page)).toContainText(source.title);
  await sql.query('ALTER TABLE "SourceRecord" RENAME TO "SourceRecord_inspection_offline"');
  try {
    await page.goto(path);
    await expect(page.locator("#inspection-error")).toHaveText(unavailable);
    await expect(selectedRecord(page)).toHaveCount(0);
    const response = await context.request.get(path);
    expect(response.status()).toBe(200);
    expectNoSharedCache(response);
    const body = await response.text();
    expect(body).not.toContain(source.title);
    expect(body).not.toContain("SourceRecord_inspection_offline");
    expect(body).not.toMatch(/postgres(?:ql)?:\/\/|PrismaClientKnownRequestError|P2021|does not exist/i);
    expect(body.includes(url)).toBe(false);

    await page.goto(selected("/admin/cms", source.name, "new"));
    await expect(page.locator("#inspection-error")).toHaveText(invalid);
    await page.goto(submitted());
    await expect(selectedRecord(page)).toContainText(collections[3].title);
  } finally {
    await sql.query('ALTER TABLE "SourceRecord_inspection_offline" RENAME TO "SourceRecord"');
  }
  await page.goto(path);
  await expect(selectedRecord(page)).toContainText(source.title);
});

test("hostile stored text and URLs stay inert on the English and Thai mobile inspection surface", async ({ page, context }) => {
  const externalRequests: string[] = [];
  await context.route("**/*", route => {
    const target = new URL(route.request().url());
    if (target.origin === inspectionOrigin) return route.continue();
    externalRequests.push(target.hostname);
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto(selected("/admin/cms", "contributions"));
  const record = selectedRecord(page);
  await expect(record).toContainText(hostileText);
  await expect(record).toContainText(hostileUrl);
  await expect(record.locator("a, iframe, img, script, form")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "inspectionExecuted"))).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.getByRole("button", { name: "ภาษาไทย", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { name: "ตรวจดูระเบียนแบบอ่านอย่างเดียว", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "ระเบียนที่เลือก", exact: true })).toContainText(hostileText);
  await expect(page.getByRole("heading", { name: "งานจัดการข้อมูลยังไม่เปิดให้ใช้งาน", exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("fresh HTML and Flight requests isolate an operator from anonymous, forged and signed-out contexts", async ({ page, context, browser }) => {
  const anonymous = await browser.newContext({ baseURL: inspectionOrigin });
  const other = await browser.newContext({ baseURL: inspectionOrigin });
  try {
    await signIn(page);
    const token = await sessionCookie(context);
    await page.goto(inspectionPaths[0]);
    await expect(selectedRecord(page)).toContainText(source.title);
    for (const path of inspectionPaths) await expectDenied(anonymous.request, path);
    await anonymous.addCookies([
      { name: "admin_session", value: "true", url: inspectionOrigin },
      { name: "user_role", value: "ADMIN", url: inspectionOrigin },
      { name: "user_email", value: operatorEmail, url: inspectionOrigin },
      { name: token.name, value: "0".repeat(64), url: inspectionOrigin }
    ]);
    for (const path of inspectionPaths) await expectDenied(anonymous.request, path);
    const otherPage = await other.newPage();
    await signIn(otherPage);
    await anonymous.addCookies([token]);
    await responseContainsOnlyProjection(await anonymous.request.get(inspectionPaths[0]), source.title, token.value);

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/admin-login$/);
    for (const path of inspectionPaths) await expectDenied(anonymous.request, path);
    const replayPage = await anonymous.newPage();
    await replayPage.goto(inspectionPaths[0]);
    await expect(replayPage).toHaveURL(/\/admin-login$/);
    await expect(selectedRecord(replayPage)).toHaveCount(0);
    await otherPage.goto(inspectionPaths[0]);
    await expect(selectedRecord(otherPage)).toContainText(source.title);
  } finally {
    await Promise.all([anonymous.close(), other.close()]);
  }
});

test("database expiry and revocation reject fresh requests while replay cookies are still present", async ({ page, context }, testInfo) => {
  for (const invalidation of ["expiry", "revocation"]) {
    await signIn(page);
    const cookie = await sessionCookie(context);
    const tokenHash = createHash("sha256").update(cookie.value).digest("hex");
    await page.goto(inspectionPaths[0]);
    await expect(selectedRecord(page)).toContainText(source.title);
    // A history navigation and a fresh server response are separate observations.
    if (invalidation === "revocation") await page.goto("/profile");
    const column = invalidation === "expiry" ? "expiresAt" : "revokedAt";
    const change = await sql.query(`UPDATE "OperatorSession" SET "${column}" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE "tokenHash" = $1`, [tokenHash]);
    expect(change.rowCount).toBe(1);
    expect((await sessionCookie(context)).value === cookie.value).toBe(true);
    if (invalidation === "revocation") {
      // Interception disables Chromium's HTTP cache. A history restoration
      // without a request is still possible and is outside session revocation.
      const historyTarget = new URL(inspectionPaths[0], inspectionOrigin).href;
      let requested = false;
      await context.route(historyTarget, route => {
        requested = route.request().isNavigationRequest();
        return route.continue();
      });
      try {
        await page.goBack();
        testInfo.annotations.push({
          type: "history observation",
          description: requested ? "Back requested the inspection document" : "Back made no inspection document request"
        });
        if (requested) {
          await expect(page).toHaveURL(/\/admin-login$/);
          await expect(selectedRecord(page)).toHaveCount(0);
        }
      } finally {
        await context.unroute(historyTarget);
      }
    }
    for (const path of inspectionPaths) await expectDenied(context.request, path);
    await page.goto(inspectionPaths[0]);
    await expect(page).toHaveURL(/\/admin-login$/);
  }
});

test("operator configuration rotation rejects fresh requests replaying a previously authorized cookie", async ({ page, context }) => {
  await signIn(page);
  const cookie = await sessionCookie(context);
  await page.goto(inspectionPaths[0]);
  await expect(selectedRecord(page)).toContainText(source.title);
  const result = await sql.query<{ activeFingerprint: string }>('SELECT "activeFingerprint" FROM "OperatorAuthState" WHERE id = $1', ["operator"]);
  const rotated = readOperatorConfig(inspectionEnvironment(url, await hashOperatorPassword(operatorPassword), "inspection-rotated-epoch"));
  if (!rotated) throw new Error("Expected valid synthetic rotation settings");
  const prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    expect(await createPostgresAuthStore(prisma).activate(rotated, result.rows[0].activeFingerprint)).toBe(true);
    expect((await sessionCookie(context)).value === cookie.value).toBe(true);
    for (const path of inspectionPaths) await expectDenied(context.request, path);
    await page.goto(inspectionPaths[0]);
    await expect(page).toHaveURL(/\/admin-login$/);
  } finally {
    await prisma.$disconnect();
  }
});
