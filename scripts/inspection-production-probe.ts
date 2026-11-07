import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "../generated/prisma/index.js";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { createPostgresAuthStore } from "../lib/operator-auth/postgres-store";
import { createOperatorAuthService } from "../lib/operator-auth/service";
import { collections, createInspectionFixture, excluded, oldestId } from "../test-integration/admin-inspection-fixture";
import { businessSnapshot, operatorEmail, operatorPassword, scratchBaseUrl } from "../test-integration/fixture";

// Run after the production build, with ISSUE4_AUTH_ACCEPTANCE=1 and the
// disposable localhost:5544 database URL. This uses raw HTTP on loopback
// with an explicit production cookie. It exercises neither TLS nor login transport.
scratchBaseUrl();
const host = "127.0.0.1";
const port = 3106;
const base = `http://${host}:${port}`;
const availability = createServer();
await new Promise<void>((resolve, reject) => availability.once("error", reject).listen(port, host, resolve));
await new Promise<void>((resolve, reject) => availability.close(error => error ? reject(error) : resolve()));

const fixture = await createInspectionFixture(undefined, `https://${host}:${port}`);
const prisma = new PrismaClient({ datasourceUrl: fixture.url, log: [] });
let child: ReturnType<typeof spawn> | undefined;
try {
  const before = await businessSnapshot(fixture.sql);
  const config = readOperatorConfig(fixture.environment);
  assert.ok(config?.production && config.secureCookie, "Production auth settings are required");
  const store = createPostgresAuthStore(prisma);
  const auth = createOperatorAuthService({ config: () => config, store: async () => store });
  const login = await auth.loginOperator({ email: operatorEmail, password: operatorPassword });
  assert.ok(login.ok, "Synthetic operator could not get a production session");
  const token = login.token;

  const require = createRequire(import.meta.url);
  child = spawn(process.execPath, [
    require.resolve("next/dist/bin/next"), "start", "--hostname", host, "--port", String(port)
  ], {
    env: {
      ...process.env,
      ...fixture.environment,
      NEXT_TELEMETRY_DISABLED: "1",
      PRISMA_LOG_LEVEL: "silent",
      NETWORK_GRAPH_SOURCE: "file",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      GITHUB_TOKEN: "",
      YOUTUBE_API_KEY: ""
    },
    windowsHide: true,
    stdio: "ignore"
  });
  let spawnFailed = false;
  child.once("error", () => { spawnFailed = true; });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !spawnFailed && child.exitCode === null; attempt++) {
    try {
      ready = (await fetch(`${base}/admin-login`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch { /* The dedicated server may still be starting. */ }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready && child.exitCode === null, "Production inspection server failed to start. Run the production build before the probe.");

  const cookie = `__Host-operator_session=${token}`;
  const query = new URLSearchParams({ collection: "submitted-data", selectedId: oldestId });
  const aliasQuery = new URLSearchParams({ selectedId: oldestId });
  const routes = [`/admin?${query}`, `/admin/cms?${query}`, `/admin/submitted-data?${aliasQuery}`];
  const title = collections[3].title;
  const rawError = /postgres(?:ql)?:\/\/|PrismaClientKnownRequestError|P2021|does not exist|SubmittedData_inspection_offline/i;

  async function read(path: string, flight: boolean, authorized: boolean) {
    const headers = new Headers();
    if (flight) headers.set("RSC", "1");
    if (authorized) headers.set("Cookie", cookie);
    const response = await fetch(base + path, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const body = await response.text();
    assert.ok(!body.includes(token), "A raw production response exposed the operator token");
    assert.ok(!body.includes(fixture.url) && !rawError.test(body), "A raw production response exposed storage error details");
    for (const sentinel of Object.values(excluded)) {
      assert.ok(!body.includes(sentinel), "A raw production response exposed an excluded field");
    }
    return { response, body };
  }

  function expectPrivateResponse(response: Response, flight: boolean) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", flight ? /^text\/x-component/i : /^text\/html/i);
    const cache = response.headers.get("cache-control") ?? "";
    assert.match(cache, /\bprivate\b/i);
    assert.match(cache, /\bno-store\b/i);
    assert.doesNotMatch(cache, /\bpublic\b|\bs-maxage\b/i);
  }

  for (const path of routes) {
    for (const flight of [false, true]) {
      const authorized = await read(path, flight, true);
      expectPrivateResponse(authorized.response, flight);
      assert.ok(authorized.body.includes(title), "The authorized response omitted the fixture");
      assert.ok(!(await read(path, flight, false)).body.includes(title), "An anonymous response disclosed the fixture");
    }
  }

  await fixture.sql.query('ALTER TABLE "SubmittedData" RENAME TO "SubmittedData_inspection_offline"');
  try {
    for (const path of routes) {
      for (const flight of [false, true]) {
        const failed = await read(path, flight, true);
        expectPrivateResponse(failed.response, flight);
        assert.ok(failed.body.includes("Inspection unavailable"), "The response omitted the unavailable state");
        assert.ok(!failed.body.includes(title), "A failed lookup disclosed the previous record");
      }
    }
  } finally {
    await fixture.sql.query('ALTER TABLE "SubmittedData_inspection_offline" RENAME TO "SubmittedData"');
  }

  assert.ok((await read(routes[0], false, true)).body.includes(title), "Inspection did not recover after storage was restored");
  assert.ok((await auth.revokeOperatorSession(token)).ok);
  for (const path of routes) {
    for (const flight of [false, true]) {
      assert.ok(!(await read(path, flight, true)).body.includes(title), "A fresh response disclosed the fixture after revocation");
    }
  }
  assert.equal(await businessSnapshot(fixture.sql) === before, true, "The probe changed business rows");
  console.log("Production inspection passed on all three routes for HTML and Flight, including failure recovery and revoked replay.");
} finally {
  child?.kill();
  await prisma.$disconnect();
  await fixture.sql.end();
}
