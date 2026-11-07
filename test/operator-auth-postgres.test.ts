import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { PrismaClient } from "../generated/prisma";
import { createPostgresAuthStore } from "../lib/operator-auth/postgres-store";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { createOperatorAuthService, tokenDigest } from "../lib/operator-auth/service";
import { disposablePostgresUrl } from "../test-integration/fixture";

// Explicit opt-in and database name guard: this suite only modifies disposable auth tables.
const enabled = process.env.OPERATOR_AUTH_TEST_DB === "1";
const suppliedUrl = process.env.DATABASE_URL;
const guardedUrl = enabled && suppliedUrl ? disposablePostgresUrl(suppliedUrl) : null;
if (enabled) {
  assert.ok(guardedUrl?.pathname === "/hri_issue4_test", "Disposable auth test database required");
}
const url = guardedUrl?.toString();
const prisma = enabled ? new PrismaClient({ datasourceUrl: url, log: [] }) : null;
const config = readOperatorConfig({ OPERATOR_EMAIL: "operator@example.invalid", OPERATOR_PASSWORD_HASH: `scrypt$32768$8$3$${"01".repeat(16)}$${"02".repeat(64)}`, OPERATOR_AUTH_EPOCH: "epoch-one", OPERATOR_APP_ORIGIN: "http://localhost:3104", DATABASE_URL: url || "postgresql://synthetic:synthetic@localhost:5544/hri_issue4_test", NODE_ENV: "test" })!;
beforeEach(async () => { if (prisma) { await prisma.operatorSession.deleteMany(); await prisma.operatorAuthState.deleteMany(); } });
after(async () => { await prisma?.$disconnect(); });
const dbTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled }, fn);

dbTest("real DB activation is explicit; concurrent admissions reserve exactly five and count successes", async () => {
  const store = createPostgresAuthStore(prisma!);
  assert.deepEqual(await store.reserveAttempt(config.fingerprint), { kind: "INACTIVE" });
  assert.equal(await store.initialize(config), true);
  assert.equal(await store.initialize(config), false);
  const results = await Promise.all(Array.from({ length: 20 }, () => store.reserveAttempt(config.fingerprint)));
  assert.equal(results.filter(x => x.kind === "ADMITTED").length, 5);
  assert.equal(results.filter(x => x.kind === "THROTTLED").length, 15);
  assert.equal((await prisma!.operatorAuthState.findUniqueOrThrow({ where: { id: "operator" } })).attemptCount, 5);
  await prisma!.$executeRaw`UPDATE "OperatorAuthState" SET "windowStartedAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '15 minutes'`;
  assert.deepEqual(await store.reserveAttempt(config.fingerprint), { kind: "ADMITTED" });
});

dbTest("real DB issues four-hour hash-only independent sessions and enforces expiry/revocation", async () => {
  const store = createPostgresAuthStore(prisma!);
  await store.initialize(config);
  const auth = createOperatorAuthService({ config: () => config, store: async () => store, verifyPassword: async () => true });
  const a = await auth.loginOperator({ email: config.email, password: "synthetic" });
  const b = await auth.loginOperator({ email: config.email, password: "synthetic" });
  assert.equal(a.ok, true); assert.equal(b.ok, true); if (!a.ok || !b.ok) return;
  const row = await prisma!.operatorSession.findUniqueOrThrow({ where: { tokenHash: tokenDigest(a.token) } });
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 4 * 3600 * 1000);
  assert.notEqual(row.tokenHash, a.token);
  await auth.revokeOperatorSession(a.token);
  assert.equal((await auth.readOperatorSession(a.token)).ok, false);
  assert.equal((await auth.readOperatorSession(b.token)).ok, true);
  await prisma!.$executeRaw`UPDATE "OperatorSession" SET "expiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second'`;
  assert.deepEqual(await auth.readOperatorSession(b.token), { ok: false, code: "UNAUTHENTICATED" });
});

dbTest("rotation checks expected fingerprint and fresh epoch, rejects paused old login; global revoke permits later issuance", async () => {
  const store = createPostgresAuthStore(prisma!);
  assert.equal(await store.initialize(config), true);
  const rotated = { ...config, epoch: "epoch-two", fingerprint: "b".repeat(64) };
  assert.equal(await store.activate(rotated, "c".repeat(64)), false);
  assert.equal(await store.activate({ ...rotated, epoch: config.epoch }, config.fingerprint), false);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { started = resolve; });
  const auth = createOperatorAuthService({ config: () => config, store: async () => store, verifyPassword: async () => { started(); await gate; return true; } });
  const pending = auth.loginOperator({ email: config.email, password: "synthetic" });
  await reached;
  assert.equal(await store.activate(rotated, config.fingerprint), true);
  release();
  assert.deepEqual(await pending, { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await store.reserveAttempt(config.fingerprint), { kind: "INACTIVE" });
  const oldHash = "d".repeat(64), newHash = "e".repeat(64);
  await store.issueSession({ fingerprint: rotated.fingerprint, tokenHash: oldHash });
  await store.revokeAll();
  assert.equal(await store.readSession({ fingerprint: rotated.fingerprint, tokenHash: oldHash }), false);
  assert.ok(await store.issueSession({ fingerprint: rotated.fingerprint, tokenHash: newHash }));
  assert.equal(await store.readSession({ fingerprint: rotated.fingerprint, tokenHash: newHash }), true);
});

dbTest("CLI initializes explicitly, rotates with expected fingerprint and revokes all without exposing credentials", async () => {
  const { spawnSync } = await import("node:child_process");
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", OPERATOR_EMAIL: config.email, OPERATOR_PASSWORD_HASH: config.passwordHash, OPERATOR_AUTH_EPOCH: config.epoch, OPERATOR_APP_ORIGIN: config.origin };
  const run = (args: string[], env = childEnv) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/operator-auth.ts", ...args], { cwd: process.cwd(), env, encoding: "utf8", timeout: 15000 });
    for (const value of [config.passwordHash, config.databaseUrl]) assert.equal((result.stdout + result.stderr).includes(value), false);
    return result;
  };
  assert.equal(run(["init"]).status, 0);
  assert.equal(run(["init"]).status, 1);
  assert.equal(run(["activate", "--expected", "0".repeat(64)]).status, 1);
  const rotatedEnv = { ...childEnv, OPERATOR_AUTH_EPOCH: "cli-rotated-epoch" };
  const rotated = readOperatorConfig(rotatedEnv)!;
  assert.equal(run(["activate", "--expected", config.fingerprint], rotatedEnv).status, 0);
  const store = createPostgresAuthStore(prisma!);
  await store.issueSession({ fingerprint: rotated.fingerprint, tokenHash: "1".repeat(64) });
  assert.equal(run(["revoke-all"], rotatedEnv).status, 0);
  assert.equal(await store.readSession({ fingerprint: rotated.fingerprint, tokenHash: "1".repeat(64) }), false);
});
