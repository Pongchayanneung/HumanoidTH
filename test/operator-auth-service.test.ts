import assert from "node:assert/strict";
import { test } from "node:test";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { createOperatorAuthService, tokenDigest } from "../lib/operator-auth/service";
import type { OperatorAuthStore } from "../lib/operator-auth/store";

const config = readOperatorConfig({ OPERATOR_EMAIL: "operator@example.invalid", OPERATOR_PASSWORD_HASH: `scrypt$32768$8$3$${"01".repeat(16)}$${"02".repeat(64)}`, OPERATOR_AUTH_EPOCH: "epoch-one", OPERATOR_APP_ORIGIN: "http://localhost:3104", DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5544/hri_issue4_test", NODE_ENV: "test" })!;
function fixture() {
  let attempts = 0, verified = 0;
  const sessions = new Set<string>();
  const expiresAt = new Date("2030-01-01T00:00:00Z");
  const store: OperatorAuthStore = {
    reserveAttempt: async () => ++attempts <= 5 ? { kind: "ADMITTED" } : { kind: "THROTTLED", retryAfterSeconds: 900 },
    issueSession: async ({ tokenHash }) => { sessions.add(tokenHash); return expiresAt; },
    readSession: async ({ tokenHash }) => sessions.has(tokenHash),
    revokeSession: async hash => { sessions.delete(hash); },
    initialize: async () => true, activate: async () => true, revokeAll: async () => { sessions.clear(); }
  };
  const auth = createOperatorAuthService({ config: () => config, store: async () => store, verifyPassword: async password => { verified++; return password === "  exact synthetic password  "; } });
  return { auth, sessions, expiresAt, verified: () => verified, attempts: () => attempts };
}

test("login derives unknown email, counts successful attempts and keeps device sessions independent", async () => {
  const f = fixture();
  assert.deepEqual(await f.auth.loginOperator({ email: "unknown@example.invalid", password: "  exact synthetic password  " }), { ok: false, code: "INVALID_CREDENTIALS" });
  assert.equal(f.verified(), 1);
  const input = { email: " OPERATOR@example.invalid ", password: "  exact synthetic password  " };
  const a = await f.auth.loginOperator(input), b = await f.auth.loginOperator(input);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.token, b.token);
  assert.equal(f.sessions.has(a.token), false);
  assert.equal(f.sessions.has(tokenDigest(a.token)), true);
  assert.deepEqual(await f.auth.readOperatorSession(a.token), { ok: true, principal: { kind: "operator", email: config.email } });
  assert.deepEqual(await f.auth.revokeOperatorSession(a.token), { ok: true });
  assert.deepEqual(await f.auth.readOperatorSession(a.token), { ok: false, code: "UNAUTHENTICATED" });
  assert.equal((await f.auth.readOperatorSession(b.token)).ok, true);
  await f.auth.loginOperator(input); await f.auth.loginOperator(input);
  assert.deepEqual(await f.auth.loginOperator(input), { ok: false, code: "THROTTLED", retryAfterSeconds: 900 });
  assert.equal(f.verified(), 5);
});

test("missing/malformed sessions and invalid config never construct storage; handled DB failures are generic", async () => {
  let constructed = 0;
  const unavailable = createOperatorAuthService({ config: () => null, store: async () => { constructed++; throw new Error("sensitive"); } });
  assert.deepEqual(await unavailable.loginOperator({ email: config.email, password: "synthetic" }), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await unavailable.readOperatorSession("f".repeat(64)), { ok: false, code: "UNAVAILABLE" });
  const auth = createOperatorAuthService({ config: () => config, store: async () => { constructed++; throw new Error("sensitive"); } });
  assert.deepEqual(await auth.readOperatorSession(), { ok: false, code: "UNAUTHENTICATED" });
  assert.deepEqual(await auth.readOperatorSession("forged"), { ok: false, code: "UNAUTHENTICATED" });
  assert.deepEqual(await auth.revokeOperatorSession("forged"), { ok: true });
  assert.equal(constructed, 0);
  assert.deepEqual(await auth.loginOperator({ email: config.email, password: "synthetic" }), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await auth.readOperatorSession("f".repeat(64)), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await auth.revokeOperatorSession("f".repeat(64)), { ok: false, code: "UNAVAILABLE" });
  assert.equal(constructed, 3);
});

test("oversized input is rejected before quota/KDF; verifier failure spends admitted quota and releases queue", async () => {
  const f = fixture();
  assert.deepEqual(await f.auth.loginOperator({ email: "x".repeat(255), password: "synthetic" }), { ok: false, code: "INVALID_CREDENTIALS" });
  assert.deepEqual(await f.auth.loginOperator({ email: config.email, password: "ก".repeat(342) }), { ok: false, code: "INVALID_CREDENTIALS" });
  assert.equal(f.attempts(), 0); assert.equal(f.verified(), 0);
  let reservations = 0, calls = 0;
  const baseStore: OperatorAuthStore = {
    reserveAttempt: async () => { reservations++; return { kind: "ADMITTED" }; }, issueSession: async () => new Date(), readSession: async () => false,
    revokeSession: async () => {}, initialize: async () => false, activate: async () => false, revokeAll: async () => {}
  };
  const auth = createOperatorAuthService({ config: () => config, store: async () => baseStore, verifyPassword: async () => { calls++; if (calls === 1) throw new Error("synthetic"); return false; } });
  assert.deepEqual(await auth.loginOperator({ email: config.email, password: "synthetic" }), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await auth.loginOperator({ email: config.email, password: "synthetic" }), { ok: false, code: "INVALID_CREDENTIALS" });
  assert.equal(reservations, 2); assert.equal(calls, 2);
});
