import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Run the real handlers in an isolated module graph. Only external effects and
// Next request context are replaced; accidental business access throws/counts.
const setup = `
  import assert from "node:assert/strict";
  import { mock } from "node:test";
  const effects = { business: 0, provider: 0, revalidate: 0, cookieRead: 0, cookieWrite: 0, auth: 0 };
  let identity = "anonymous";
  let signInResult = { ok: false, code: "UNAVAILABLE" };
  let signOutResult = { ok: false, code: "UNAVAILABLE" };
  let credentials;
  const forbiddenBusiness = new Proxy({}, { get() { effects.business++; throw Error("Business access forbidden"); } });
  mock.module(new URL("./lib/prisma.ts", import.meta.url), { namedExports: { prisma: forbiddenBusiness } });
  mock.module(new URL("./lib/ingest/adapters.ts", import.meta.url), { namedExports: {
    runAdapter: async () => { effects.provider++; throw Error("Provider access forbidden"); }
  } });
  globalThis.fetch = async () => { effects.provider++; throw Error("Fetch forbidden"); };
  mock.module("next/cache", { namedExports: { revalidatePath() { effects.revalidate++; } } });
  const cookieStore = {
    get(name) { effects.cookieRead++; return identity === "forged" ? { value: name === "user_email" ? "operator@example.invalid" : "true" } : undefined; },
    set(...args) { effects.cookieWrite++; cookieWrites.push(args); },
    delete() { effects.cookieWrite++; }
  };
  const cookieWrites = [];
  mock.module("next/headers", { namedExports: { cookies: async () => cookieStore } });
  mock.module("next/navigation", { namedExports: { redirect(path) { throw Object.assign(Error("redirect"), { path }); } } });
  mock.module(new URL("./lib/operator-auth/web.ts", import.meta.url), { namedExports: {
    async signInOperator(input) { effects.auth++; credentials = input; return signInResult; },
    async signOutOperator() { effects.auth++; return signOutResult; },
    async getOperatorPrincipal() { effects.auth++; return identity === "operator"
      ? { ok: true, principal: { kind: "operator", email: "operator@example.invalid" } }
      : { ok: false, code: "UNAUTHENTICATED" }; }
  } });
  const poison = new Proxy({}, { get() { throw Error("Request fields must not be read"); } });
  const poisonForm = new Proxy(new FormData(), { get() { throw Error("FormData fields must not be read"); } });
  const denied = { ok: false, code: "WORKFLOW_UNAVAILABLE" };
  const noEffects = { business: 0, provider: 0, revalidate: 0, cookieRead: 0, cookieWrite: 0, auth: 0 };
`;

function runHandlers(script: string, mocks = true) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === "DATABASE_URL" || name.startsWith("OPERATOR_") || name === "GEMINI_API_KEY") delete env[name];
  }
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning", "--disable-warning=DeprecationWarning",
    ...(mocks ? [] : ["--conditions=react-server"]),
    "--import", "tsx", "--input-type=module", "-e", (mocks ? setup : "") + script
  ], { cwd: process.cwd(), env, encoding: "utf8", timeout: 20_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
}

test("disabled actions deny poisoned input without effects for anonymous, forged and operator identities", () => {
  runHandlers(`
    const actions = await import("./app/actions.ts");
    for (identity of ["anonymous", "forged", "operator"]) {
      for (const name of ["createSubmission", "runDataPull", "registerAndLoginUser",
        "upsertSourceRecordAction", "upsertRobotModelAction", "upsertContributionAction", "upsertSubmittedDataAction"]) {
        assert.deepEqual(await actions[name](poisonForm), denied, name + ": " + identity);
      }
      assert.deepEqual(await actions.loginAsUser(poison, poison), denied);
      assert.deepEqual(await actions.updateSubmissionStatus(poison, poison), denied);
    }
    assert.deepEqual(effects, noEffects);
  `);
});

test("disabled APIs return 403 JSON before reading requests or route params", () => {
  runHandlers(`
    const { POST } = await import("./app/api/ingest/[adapter]/route.ts");
    for (identity of ["anonymous", "forged", "operator"]) {
      const ingest = await POST(poison, poison);
      assert.equal(ingest.status, 403);
      assert.deepEqual(await ingest.json(), denied);
    }
    assert.deepEqual(effects, noEffects);
    const { GET } = await import("./app/api/export/route.ts");
    for (identity of ["anonymous", "forged"]) {
      const exported = await GET(poison);
      assert.equal(exported.status, 403);
      assert.deepEqual(await exported.json(), denied);
    }
    assert.deepEqual(effects, { ...noEffects, cookieRead: 3, auth: 1 });
  `);
});

test("map analysis denies and map reads stay empty without cache, fallback or provider effects", () => {
  runHandlers(`
    const map = await import("./app/map/actions.ts");
    for (identity of ["anonymous", "forged", "operator"]) {
      assert.deepEqual(await map.analyzeClustersWithGemini(), denied);
      assert.deepEqual(await map.reanalyzeClustersWithGemini(), denied);
      assert.deepEqual(await map.fetchContributionClusters(), []);
    }
    assert.deepEqual(effects, noEffects);
  `);
});

test("login uses the operator adapter, preserves password whitespace and fixes redirect targets", () => {
  runHandlers(`
    const { adminLoginAction } = await import("./app/actions.ts");
    const form = new FormData();
    form.set("email", "operator@example.invalid");
    form.set("password", "  synthetic passphrase  ");
    form.set("redirectTo", "https://untrusted.invalid/");
    form.set("from", "//untrusted.invalid/");
    for (const [result, path] of [
      [{ ok: true }, "/admin"],
      [{ ok: false, code: "INVALID_CREDENTIALS" }, "/admin-login?error=invalid_credentials"],
      [{ ok: false, code: "THROTTLED", retryAfterSeconds: 60 }, "/admin-login?error=throttled"],
      [{ ok: false, code: "UNAVAILABLE" }, "/admin-login?error=unavailable"],
      [{ ok: false, code: "FORBIDDEN_ORIGIN" }, "/admin-login?error=forbidden_origin"]
    ]) {
      signInResult = result;
      await assert.rejects(adminLoginAction(form), error => error.path === path);
      assert.deepEqual(credentials, { email: "operator@example.invalid", password: "  synthetic passphrase  " });
    }
    assert.deepEqual(effects, { ...noEffects, auth: 5 });
  `);
});

test("logout only reports success after adapter revocation and preserves failed sessions", () => {
  runHandlers(`
    const { logoutUser } = await import("./app/actions.ts");
    for (const [result, path] of [
      [{ ok: true }, "/admin-login"],
      [{ ok: false, code: "UNAVAILABLE" }, "/admin?error=unavailable"],
      [{ ok: false, code: "FORBIDDEN_ORIGIN" }, "/admin?error=forbidden_origin"]
    ]) {
      signOutResult = result;
      await assert.rejects(logoutUser(), error => error.path === path);
    }
    assert.deepEqual(effects, { ...noEffects, auth: 3 });
  `);
});

test("language allows en/th publicly and rejects other values before cookie or cache effects", () => {
  runHandlers(`
    const { setLanguage } = await import("./app/actions.ts");
    for (const invalid of ["fr", "EN", "", null, undefined, poison]) await setLanguage(invalid);
    assert.deepEqual(effects, noEffects);
    await setLanguage("en");
    await setLanguage("th");
    assert.deepEqual(cookieWrites, [["lang", "en", { path: "/" }], ["lang", "th", { path: "/" }]]);
    assert.deepEqual(effects, { ...noEffects, cookieWrite: 2, revalidate: 2 });
  `);
});

test("boundary modules import without database or operator configuration", () => {
  runHandlers(`
    import { mock } from "node:test";
    // Standalone Node cannot load Next's client navigation context under the
    // react-server condition. Keep the actual auth/storage import graph intact.
    mock.module("next/navigation", { namedExports: { redirect() { throw Error("Unexpected redirect"); } } });
    await import("./app/actions.ts");
    await import("./app/map/actions.ts");
    await import("./app/api/ingest/[adapter]/route.ts");
    await import("./app/api/export/route.ts");
  `, false);
});
