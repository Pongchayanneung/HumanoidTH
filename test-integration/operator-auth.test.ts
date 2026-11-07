import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, test as nodeTest, type TestContext } from "node:test";
import { PrismaClient } from "../generated/prisma/index.js";
import { createOperatorAuthService } from "../lib/operator-auth/service";
import { createPostgresAuthStore } from "../lib/operator-auth/postgres-store";
import { readOperatorConfig, type OperatorConfig } from "../lib/operator-auth/config";
import { DerivationQueue, hashOperatorPassword } from "../lib/operator-auth/credentials";
import type { LoginResult } from "../lib/operator-auth/contracts";
import { businessSnapshot, createAcceptanceDatabase, openSql, operatorEmail, operatorPassword, syntheticEnvironment } from "./fixture";

const test = (name: string, operation: (context: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30_000 }, operation);

let fixture: Awaited<ReturnType<typeof createAcceptanceDatabase>>;
let prisma: PrismaClient;
let otherPrisma: PrismaClient;
let config: OperatorConfig;
let passwordHash: string;
const credentials = { email: operatorEmail, password: operatorPassword };
const unauthorized = { ok: false, code: "UNAUTHENTICATED" };
const unavailable = { ok: false, code: "UNAVAILABLE" };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }
function successful(result: LoginResult): asserts result is Extract<LoginResult, { ok: true }> { assert.equal(result.ok, true); }
function service(overrides: Partial<Parameters<typeof createOperatorAuthService>[0]> = {}, client = prisma) {
  return createOperatorAuthService({ config: () => config, store: async () => createPostgresAuthStore(client), derivationQueue: new DerivationQueue(), ...overrides });
}

before(async () => {
  fixture = await createAcceptanceDatabase();
  prisma = new PrismaClient({ datasourceUrl: fixture.url, log: [] });
  otherPrisma = new PrismaClient({ datasourceUrl: fixture.url, log: [] });
  passwordHash = await hashOperatorPassword(operatorPassword);
});
beforeEach(async () => {
  await fixture.sql.query('DELETE FROM "OperatorSession"');
  await fixture.sql.query('DELETE FROM "OperatorAuthState"');
  config = readOperatorConfig(syntheticEnvironment(fixture.url, passwordHash))!;
  assert.ok(config);
  assert.equal(await createPostgresAuthStore(prisma).initialize(config), true);
});
after(async () => {
  await Promise.all([prisma?.$disconnect(), otherPrisma?.$disconnect(), fixture?.sql.end()]);
});

test("real credentials issue independent opaque sessions; reads do not renew and logout defeats copied-token replay", async () => {
  const auth = service();
  assert.deepEqual(await auth.readOperatorSession(), unauthorized);
  for (const token of ["true", "user@example.invalid", "admin", "a".repeat(63), "A".repeat(64), "0".repeat(64)]) assert.deepEqual(await auth.readOperatorSession(token), unauthorized);
  const first = await auth.loginOperator(credentials);
  const second = await service({}, otherPrisma).loginOperator(credentials);
  successful(first); successful(second);
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  const initial = await fixture.sql.query<{ tokenHash: string; createdAt: Date; expiresAt: Date }>('SELECT "tokenHash", "createdAt", "expiresAt" FROM "OperatorSession" ORDER BY "tokenHash"');
  assert.equal(initial.rows.length, 2);
  assert.ok(initial.rows.every(row => row.tokenHash !== first.token && row.tokenHash !== second.token));
  assert.ok(initial.rows.some(row => row.tokenHash === digest(first.token)));
  for (const row of initial.rows) assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 4 * 60 * 60 * 1000);
  assert.deepEqual(await auth.readOperatorSession(first.token), { ok: true, principal: { kind: "operator", email: operatorEmail } });
  const unchanged = await fixture.sql.query('SELECT "tokenHash", "createdAt", "expiresAt" FROM "OperatorSession" ORDER BY "tokenHash"');
  assert.deepEqual(unchanged.rows, initial.rows);
  assert.deepEqual(await auth.revokeOperatorSession(first.token), { ok: true });
  assert.deepEqual(await service({}, otherPrisma).readOperatorSession(first.token), unauthorized);
  assert.equal((await auth.readOperatorSession(second.token)).ok, true);
  await fixture.sql.query('UPDATE "OperatorSession" SET "expiresAt" = (clock_timestamp() AT TIME ZONE \'UTC\') - interval \'1 millisecond\' WHERE "tokenHash" = $1', [digest(second.token)]);
  assert.deepEqual(await auth.readOperatorSession(second.token), unauthorized);
});

test("attempt reservations are shared across independent Node processes, including successful attempts", async () => {
  const script = `
    import assert from 'node:assert/strict';
    import { PrismaClient } from './generated/prisma/index.js';
    import { createPostgresAuthStore } from './lib/operator-auth/postgres-store.ts';
    const prisma = new PrismaClient({datasourceUrl: process.env.ISSUE4_CHILD_DATABASE_URL, log: []});
    try {
      const result = await createPostgresAuthStore(prisma).reserveAttempt(process.env.ISSUE4_CHILD_FINGERPRINT);
      process.stdout.write(JSON.stringify(result));
    } finally { await prisma.$disconnect(); }
  `;
  // One successful login consumes a reservation before cross-process competition.
  successful(await service().loginOperator(credentials));
  const { spawn } = await import("node:child_process");
  const results = await Promise.all(Array.from({ length: 11 }, () => new Promise<{ kind: string; retryAfterSeconds?: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(), env: { ...process.env, ISSUE4_CHILD_DATABASE_URL: fixture.url, ISSUE4_CHILD_FINGERPRINT: config.fingerprint }, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timeout = setTimeout(() => child.kill(), 15_000);
    child.stdout.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("exit", code => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Admission child exited ${code}`));
      else { try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid admission child result")); } }
    });
  })));
  assert.equal(results.filter(item => item.kind === "ADMITTED").length, 4);
  assert.equal(results.filter(item => item.kind === "THROTTLED").length, 7);
  for (const result of results.filter(item => item.kind === "THROTTLED")) assert.ok(result.retryAfterSeconds! > 0 && result.retryAfterSeconds! <= 900);
  const sixth = await service().loginOperator(credentials);
  assert.equal(sixth.ok, false);
  if (!sixth.ok) assert.equal(sixth.code, "THROTTLED");
  const count = await fixture.sql.query<{ attemptCount: number }>('SELECT "attemptCount" FROM "OperatorAuthState"');
  assert.equal(count.rows[0].attemptCount, 5);
});

test("window time is sampled after a waiting reservation acquires the PostgreSQL lock", async () => {
  const lock = await openSql(fixture.url);
  try {
    await lock.query("BEGIN");
    await lock.query('SELECT "id" FROM "OperatorAuthState" WHERE "id" = \'operator\' FOR UPDATE');
    await lock.query('UPDATE "OperatorAuthState" SET "attemptCount" = 5, "windowStartedAt" = (clock_timestamp() AT TIME ZONE \'UTC\') - interval \'15 minutes\' + interval \'600 milliseconds\'');
    const pending = createPostgresAuthStore(otherPrisma).reserveAttempt(config.fingerprint);
    // Observe a genuine blocked lock waiter instead of assuming Promise scheduling.
    let blocked = false;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const waiting = await fixture.sql.query<{ waiting: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%OperatorAuthState%') AS waiting");
      if (waiting.rows[0].waiting) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, "Reservation must actually wait on the database row lock");
    await lock.query("SELECT pg_sleep(0.75)");
    await lock.query("COMMIT");
    assert.deepEqual(await pending, { kind: "ADMITTED" });
    const state = await fixture.sql.query<{ attemptCount: number; age: number }>('SELECT "attemptCount", EXTRACT(EPOCH FROM ((clock_timestamp() AT TIME ZONE \'UTC\') - "windowStartedAt"))::float8 AS age FROM "OperatorAuthState"');
    assert.equal(state.rows[0].attemptCount, 1);
    assert.ok(state.rows[0].age >= 0 && state.rows[0].age < 5);
  } finally { await lock.query("ROLLBACK"); await lock.end(); }
});

test("rotation invalidates existing sessions and a login paused after committed admission", async () => {
  const auth = service();
  const existing = await auth.loginOperator(credentials); successful(existing);
  const started = deferred(); const resume = deferred<boolean>();
  const pendingAuth = service({ verifyPassword: async () => { started.resolve(); return resume.promise; } }, otherPrisma);
  const pending = pendingAuth.loginOperator(credentials);
  await started.promise;
  const store = createPostgresAuthStore(prisma);
  const rotated = readOperatorConfig(syntheticEnvironment(fixture.url, passwordHash, "acceptance-epoch-two"))!;
  try {
    assert.equal(await store.activate(rotated, "wrong-fingerprint"), false);
    assert.equal(await store.activate({ ...rotated, epoch: config.epoch }, config.fingerprint), false);
    assert.equal(await store.activate(rotated, config.fingerprint), true);
  } finally { resume.resolve(true); }
  assert.deepEqual(await pending, unavailable);
  assert.deepEqual(await auth.readOperatorSession(existing.token), unauthorized);
  assert.deepEqual(await auth.loginOperator(credentials), unavailable);
  assert.equal(await store.initialize(config), false, "An old deployment cannot initialize over active configuration");
  assert.equal(await store.activate(config, config.fingerprint), false, "Stale expected fingerprint cannot rotate active configuration");
  successful(await service({ config: () => rotated }).loginOperator(credentials));
});

test("global revocation commits before a paused valid login issues a new independent session", async () => {
  const auth = service();
  const first = await auth.loginOperator(credentials); successful(first);
  const second = await auth.loginOperator(credentials); successful(second);
  const started = deferred(); const resume = deferred<boolean>();
  const pending = service({ verifyPassword: async () => { started.resolve(); return resume.promise; } }, otherPrisma).loginOperator(credentials);
  await started.promise;
  try { await createPostgresAuthStore(prisma).revokeAll(); }
  finally { resume.resolve(true); }
  const later = await pending; successful(later);
  assert.deepEqual(await auth.readOperatorSession(first.token), unauthorized);
  assert.deepEqual(await auth.readOperatorSession(second.token), unauthorized);
  assert.equal((await auth.readOperatorSession(later.token)).ok, true);
});

test("bounded derivation overflow spends admission and verifier errors release the next queued slot", async () => {
  const queue = new DerivationQueue();
  const started = deferred(); const release = deferred();
  let active = 0; let maximum = 0; let executed = 0;
  const held = queue.run(async () => { started.resolve(); await release.promise; });
  await started.promise;
  const queued = Array.from({ length: 4 }, (_, index) => queue.run(async () => {
    maximum = Math.max(maximum, ++active); executed++;
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (index === 0) throw new Error("synthetic derivation failure");
      return index;
    }
    finally { active--; }
  }));
  const outcomes = Promise.allSettled(queued);
  try {
    assert.deepEqual(await service({ derivationQueue: queue, verifyPassword: async () => true }).loginOperator(credentials), unavailable);
    const state = await fixture.sql.query<{ attemptCount: number }>('SELECT "attemptCount" FROM "OperatorAuthState"');
    assert.equal(state.rows[0].attemptCount, 1);
  } finally { release.resolve(); }
  await held;
  const results = await outcomes;
  assert.equal(results.filter(item => item.status === "rejected").length, 1);
  assert.equal(executed, 4); assert.equal(maximum, 1);
  successful(await service({ derivationQueue: queue }).loginOperator(credentials));
});

test("disabled handlers remain effect-free with a real valid operator session and hostile request objects", async () => {
  const login = await service().loginOperator(credentials); successful(login);
  const beforeBusiness = await businessSnapshot(fixture.sql);
  const script = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    let effects = 0;
    const poison = new Proxy({}, { get() { effects++; throw Error('Unexpected request access'); } });
    const prismaTrap = new Proxy({}, { get() { effects++; throw Error('Unexpected business access'); } });
    mock.module(new URL('./lib/prisma.ts', import.meta.url), { namedExports: { prisma: prismaTrap } });
    mock.module(new URL('./lib/ingest/adapters.ts', import.meta.url), { namedExports: { runAdapter() { effects++; throw Error('Unexpected provider'); } } });
    mock.module('next/headers', { namedExports: {
      cookies: async () => ({ get(name) { return name === 'operator_session_dev' ? { value: process.env.ISSUE4_CHILD_TOKEN } : undefined; }, set() { effects++; }, delete() { effects++; } }),
      headers: async () => new Headers({origin: process.env.OPERATOR_APP_ORIGIN})
    } });
    mock.module('next/navigation', { namedExports: { redirect() { effects++; throw Error('Unexpected redirect'); } } });
    mock.module('next/cache', { namedExports: { revalidatePath() { effects++; } } });
    globalThis.fetch = async () => { effects++; throw Error('Unexpected provider fetch'); };
    const auth = await import('./lib/operator-auth/index.ts');
    assert.equal((await auth.readOperatorSession(process.env.ISSUE4_CHILD_TOKEN)).ok, true);
    const actions = await import('./app/actions.ts');
    const denied = {ok:false,code:'WORKFLOW_UNAVAILABLE'};
    for (const name of ['createSubmission','runDataPull','registerAndLoginUser','upsertSourceRecordAction','upsertRobotModelAction','upsertContributionAction','upsertSubmittedDataAction']) assert.deepEqual(await actions[name](poison), denied);
    assert.deepEqual(await actions.loginAsUser(poison, poison), denied);
    assert.deepEqual(await actions.updateSubmissionStatus(poison, poison), denied);
    const map = await import('./app/map/actions.ts');
    assert.deepEqual(await map.analyzeClustersWithGemini(), denied);
    assert.deepEqual(await map.reanalyzeClustersWithGemini(), denied);
    assert.deepEqual(await map.fetchContributionClusters(), []);
    const {GET} = await import('./app/api/export/route.ts');
    const {POST} = await import('./app/api/ingest/[adapter]/route.ts');
    for (const response of [await GET(poison), await POST(poison, poison)]) {
      assert.equal(response.status,403); assert.deepEqual(await response.json(),denied);
    }
    assert.equal(effects,0);
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ["--conditions=react-server", "--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning", "--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { ...process.env, ...syntheticEnvironment(fixture.url, passwordHash), ISSUE4_CHILD_TOKEN: login.token }, encoding: "utf8", timeout: 30_000
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, "Valid-session hostile handler subprocess must succeed without effects");
  assert.equal(await businessSnapshot(fixture.sql), beforeBusiness);
});

test("missing tables and failed connections produce deliberate unavailable results", async () => {
  const noTables = await createAcceptanceDatabase(`hri_issue4_acceptance_failure_${Date.now()}`);
  const noTablesPrisma = new PrismaClient({ datasourceUrl: noTables.url, log: [] });
  let closedPrisma: PrismaClient | undefined;
  try {
    // Remove only auth tables inside this test-owned, newly created database.
    await noTables.sql.query('DROP TABLE "OperatorSession"; DROP TABLE "OperatorAuthState"');
    const auth = service({}, noTablesPrisma);
    assert.deepEqual(await auth.loginOperator(credentials), unavailable);
    assert.deepEqual(await auth.readOperatorSession("0".repeat(64)), unavailable);
    assert.deepEqual(await auth.revokeOperatorSession("0".repeat(64)), unavailable);
    const url = new URL(noTables.url); url.port = "1"; url.searchParams.set("connect_timeout", "1");
    closedPrisma = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
    assert.deepEqual(await service({}, closedPrisma).loginOperator(credentials), unavailable);
  } finally { await Promise.all([noTablesPrisma.$disconnect(), closedPrisma?.$disconnect(), noTables.sql.end()]); }
});
