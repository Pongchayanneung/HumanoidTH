import assert from "node:assert/strict";
import { test } from "node:test";
import * as config from "../lib/operator-auth/config";
import * as credentials from "../lib/operator-auth/credentials";

const hash = `scrypt$32768$8$3$${"01".repeat(16)}$${"02".repeat(64)}`;
const env = { OPERATOR_EMAIL: " Operator@Example.Invalid ", OPERATOR_PASSWORD_HASH: hash, OPERATOR_AUTH_EPOCH: "epoch-one", OPERATOR_APP_ORIGIN: "http://localhost:3104", DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5544/hri_issue4_test", NODE_ENV: "development" };

test("configuration canonicalizes shared identity and rejects unsupported KDF/origins before deriving", () => {
  assert.equal(typeof config.readOperatorConfig, "function", "configuration parser is implemented");
  const parsed = config.readOperatorConfig(env)!;
  assert.equal(parsed.email, "operator@example.invalid");
  assert.equal(parsed.fingerprint, config.readOperatorConfig({ ...env, OPERATOR_EMAIL: "operator@example.invalid" })!.fingerprint);
  assert.equal(config.readOperatorConfig({ ...env, OPERATOR_PASSWORD_HASH: hash.replace("32768", "16384") }), null);
  assert.equal(config.readOperatorConfig({ ...env, NODE_ENV: "production" }), null);
  assert.equal(config.readOperatorConfig({ ...env, OPERATOR_APP_ORIGIN: "http://example.invalid" }), null);
  assert.equal(config.readOperatorConfig({ ...env, OPERATOR_APP_ORIGIN: "https://example.invalid/path" }), null);
  assert.equal(config.readOperatorConfig({ ...env, DATABASE_URL: "prisma+postgres://example.invalid/?api_key=synthetic" }), null);
});

test("password provisioning uses approved scrypt and preserves whitespace", async () => {
  assert.equal(typeof credentials.hashOperatorPassword, "function", "password provisioner is implemented");
  await assert.rejects(() => credentials.hashOperatorPassword("too short"));
  const password = "  synthetic passphrase with spaces  ";
  const encoded = await credentials.hashOperatorPassword(password);
  assert.match(encoded, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  const parsed = config.parsePasswordHash(encoded)!;
  assert.equal(await credentials.verifyOperatorPassword(password, parsed), true);
  assert.equal(await credentials.verifyOperatorPassword(password.trim(), parsed), false);
});

test("derivations serialize one active and four queued, reject overflow, release after errors", async () => {
  assert.equal(typeof credentials.DerivationQueue, "function", "bounded derivation queue is implemented");
  const queue = new credentials.DerivationQueue();
  let active = 0, maxActive = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const operation = async () => { active++; maxActive = Math.max(maxActive, active); await gate; active--; return true; };
  const pending = Array.from({ length: 5 }, () => queue.run(operation));
  const overflow = queue.run(operation);
  release();
  await assert.rejects(() => overflow, /capacity/i);
  await Promise.all(pending);
  assert.equal(maxActive, 1);
  await assert.rejects(() => queue.run(async () => { throw new Error("synthetic"); }));
  assert.equal(await queue.run(async () => true), true);
});


// Removing Next-compatible expansion must make this real-file regression fail.
test("shared environment loader expands escaped scrypt dollars exactly as Next does", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { spawnSync } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "operator-auth-env-"));
  try {
    await writeFile(join(directory, ".env.local"), Object.entries(env).filter(([key]) => key !== "NODE_ENV").map(([key, value]) => `${key}="${value.replaceAll("$", "\\$")}"`).join("\n"));
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
    for (const key of Object.keys(childEnv)) if (key.startsWith("OPERATOR_") || key === "DATABASE_URL") delete childEnv[key];
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const {loadAuthEnvironment,readOperatorConfig} = await import(${JSON.stringify(pathToFileURL(resolve("lib/operator-auth/config.ts")).href)});
      process.chdir(${JSON.stringify(directory)});
      loadAuthEnvironment();
      const config = readOperatorConfig();
      if (!config) process.exit(2);
      process.stdout.write(config.fingerprint);
    `], { cwd: process.cwd(), env: childEnv, encoding: "utf8", timeout: 15000 });
    assert.equal(child.status, 0, "escaped hash configuration should load (without printing its contents)");
    assert.equal(child.stdout, config.readOperatorConfig(env)!.fingerprint);
    for (const implementation of [
      `const nextEnv = (await import("@next/env")).default; nextEnv.loadEnvConfig(process.cwd(), true, {info(){},error(){}}); const c = await import(${JSON.stringify(pathToFileURL(resolve("lib/operator-auth/config.ts")).href)}); process.stdout.write(c.readOperatorConfig().fingerprint);`,
      `const cli = await import(${JSON.stringify(pathToFileURL(resolve("scripts/operator-auth.ts")).href)}); process.exitCode = await cli.runOperatorAuthCli(["fingerprint"]);`
    ]) {
      const comparison = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `process.chdir(${JSON.stringify(directory)}); ${implementation}`], { cwd: process.cwd(), env: childEnv, encoding: "utf8", timeout: 15000 });
      assert.equal(comparison.status, 0, "Next and CLI environment loading should succeed");
      assert.equal(comparison.stdout.trim(), child.stdout);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
