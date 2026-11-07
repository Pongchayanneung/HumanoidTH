import assert from "node:assert/strict";
import { test } from "node:test";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { createOperatorWebAdapter, sessionCookieName, type CookieOptions } from "../lib/operator-auth/web-adapter";
const config = readOperatorConfig({ OPERATOR_EMAIL: "operator@example.invalid", OPERATOR_PASSWORD_HASH: `scrypt$32768$8$3$${"01".repeat(16)}$${"02".repeat(64)}`, OPERATOR_AUTH_EPOCH: "epoch-one", OPERATOR_APP_ORIGIN: "https://auth.example.invalid", DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5544/hri_issue4_test", NODE_ENV: "production" })!;
function fixture(origin: string | null = config.origin) {
  let failRevoke = false, coreCalls = 0;
  const values = new Map([[sessionCookieName(config), "a".repeat(64)], ["user_email", config.email], ["user_role", "ADMIN"], ["admin_session", "true"]]);
  const writes: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const adapter = createOperatorWebAdapter({ config: () => config, cookies: async () => ({ get: name => values.has(name) ? { value: values.get(name)! } : undefined, set: (name, value, options) => { writes.push({ name, value, options }); values.set(name, value); } }), headers: async () => ({ get: () => origin }), core: {
    loginOperator: async () => { coreCalls++; return { ok: true, token: "b".repeat(64), expiresAt: new Date("2030-01-01") }; },
    readOperatorSession: async token => { coreCalls++; return token === "a".repeat(64) ? { ok: true, principal: { kind: "operator", email: config.email } } : { ok: false, code: "UNAUTHENTICATED" }; },
    revokeOperatorSession: async () => { coreCalls++; return failRevoke ? { ok: false, code: "UNAVAILABLE" } : { ok: true }; }
  } });
  return { adapter, writes, values, coreCalls: () => coreCalls, failRevoke: () => { failRevoke = true; } };
}

test("same-origin login sets host-only strict secure token cookie, returns no token and clears legacy authority", async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.signInOperator({ email: config.email, password: "synthetic" }), { ok: true });
  const cookie = f.writes.find(write => write.name === "__Host-operator_session")!;
  assert.ok(cookie);
  assert.deepEqual(cookie.options, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 14400, expires: new Date("2030-01-01") });
  for (const name of ["user_email", "user_role", "admin_session"]) assert.equal(f.writes.find(write => write.name === name)?.options.maxAge, 0);
});

test("missing/cross origin is rejected before credential or cookie effects", async () => {
  for (const origin of [null, "https://hostile.example.invalid", config.origin + "/", "null"]) {
    const f = fixture(origin);
    assert.deepEqual(await f.adapter.signInOperator({ email: config.email, password: "synthetic" }), { ok: false, code: "FORBIDDEN_ORIGIN" });
    assert.deepEqual(await f.adapter.signOutOperator(), { ok: false, code: "FORBIDDEN_ORIGIN" });
    assert.equal(f.coreCalls(), 0); assert.equal(f.writes.length, 0);
  }
});

test("logout retains cookie on revocation failure and ignores legacy cookies during session read", async () => {
  const f = fixture(); f.failRevoke();
  assert.deepEqual(await f.adapter.signOutOperator(), { ok: false, code: "UNAVAILABLE" });
  assert.equal(f.writes.length, 0);
  f.values.delete("__Host-operator_session");
  assert.deepEqual(await f.adapter.getOperatorPrincipal(), { ok: false, code: "UNAUTHENTICATED" });
  const success = fixture();
  assert.deepEqual(await success.adapter.signOutOperator(), { ok: true });
  assert.equal(success.writes.find(write => write.name === "__Host-operator_session")?.options.maxAge, 0);
});
