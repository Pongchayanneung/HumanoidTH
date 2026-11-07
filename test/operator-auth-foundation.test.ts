import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Subprocess proves the public import graph remains lazy and fail-closed.
test("auth imports without database configuration and fails closed before activation", () => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === "DATABASE_URL" || name.startsWith("OPERATOR_")) delete env[name];
  }
  const child = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const core = await import("./lib/operator-auth/index.ts");
    const web = await import("./lib/operator-auth/web.ts");
    const unavailable = { ok: false, code: "UNAVAILABLE" };
    assert.deepEqual(await core.loginOperator({ email: "operator@example.invalid", password: "synthetic" }), unavailable);
    assert.deepEqual(await core.readOperatorSession(), unavailable);
    assert.deepEqual(await core.readOperatorSession("forged"), unavailable);
    assert.deepEqual(await core.revokeOperatorSession("forged"), unavailable);
    assert.deepEqual(await web.signInOperator({ email: "operator@example.invalid", password: "synthetic" }), unavailable);
    assert.deepEqual(await web.signOutOperator(), unavailable);
    assert.deepEqual(await web.getOperatorPrincipal(), unavailable);
  `], { cwd: process.cwd(), env, encoding: "utf8", timeout: 15_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
