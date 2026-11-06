import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSeedAllowed } from "../lib/seed-guard";

const ON = { ATLAS_ALLOW_SEED: "1" };
const LOCAL = "postgresql://postgres@localhost:55432/atlas_test";

function refused(url: string | undefined, env: Record<string, string | undefined> = ON) {
  return assert.throws(() => assertSeedAllowed(url, env), Error);
}

test("refuses without ATLAS_ALLOW_SEED and names the variable", () => {
  assert.throws(() => assertSeedAllowed(LOCAL, {}), /ATLAS_ALLOW_SEED=1/);
});

test("flag must be exactly 1", () => {
  for (const value of ["0", "true", "", "yes", "1 "]) {
    refused(LOCAL, { ATLAS_ALLOW_SEED: value });
  }
});

test("allows local hosts when flagged", () => {
  for (const url of [
    LOCAL,
    "postgres://postgres@localhost/x",
    "postgresql://u:p@127.0.0.1:5432/x?schema=public",
    "postgresql://postgres@[::1]:5432/x",
    "postgresql://postgres@LOCALHOST/x"
  ]) {
    assert.doesNotThrow(() => assertSeedAllowed(url, ON), url);
  }
});

test("refuses remote and lookalike hosts", () => {
  for (const url of [
    "postgresql://u@db.example.com:5432/x",
    "postgresql://localhost.evil.com/x",
    "postgresql://127.0.0.1.evil.com/x",
    "postgresql://localhost@evil.com/x",
    "postgresql://localhost:pw@evil.com/x",
    "postgresql://a@localhost@evil.com/x",
    "postgresql://localhost,evil.com/x",
    "postgresql://%6cocalhost/x",
    "postgresql://0.0.0.0/x"
  ]) {
    refused(url);
  }
});

test("refuses host overrides in the query string", () => {
  for (const url of [
    "postgresql://localhost/x?host=evil.com",
    "postgresql://localhost/x?hostaddr=203.0.113.9",
    "postgresql://localhost/x?service=prod",
    "postgresql://localhost/x?schema=public&host=evil.com",
    "postgresql://localhost/x?host=%2Fvar%2Frun%2Fpostgresql"
  ]) {
    refused(url);
  }
});

test("refuses empty host, bad protocol, missing and invalid URLs", () => {
  refused("postgresql:///x");
  refused("postgresql://:5432/x");
  refused("prisma+postgres://accelerate.prisma-data.net/?api_key=SECRET");
  refused("http://localhost/x");
  refused(undefined);
  refused("");
  refused("not a url");
});

test("error messages never leak the connection string", () => {
  const secrets = [
    "prisma+postgres://accelerate.prisma-data.net/?api_key=SECRETKEY",
    "postgresql://admin:hunter2pw@db.example.com/x",
    "postgresql://localhost/x?host=hunter2host",
    "not a url hunter2pw"
  ];
  for (const url of secrets) {
    try {
      assertSeedAllowed(url, ON);
      assert.fail("expected refusal");
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(!/SECRETKEY|hunter2|accelerate|example\.com/.test(message), message);
    }
  }
});

// Choke point: every seeding path builds its client here. Refusal paths only,
// so no client is ever constructed or connected. Imported lazily so the pure
// cases above do not need a generated Prisma client.
test("createSeedClient enforces the guard", async () => {
  const saved = { ...process.env };
  try {
    const { createSeedClient } = await import("../lib/seed-importer");
    process.env.DATABASE_URL = LOCAL;
    delete process.env.ATLAS_ALLOW_SEED;
    assert.throws(() => createSeedClient(), /ATLAS_ALLOW_SEED=1/);

    process.env.ATLAS_ALLOW_SEED = "1";
    process.env.DATABASE_URL = "postgresql://u@db.example.com/x";
    assert.throws(() => createSeedClient(), /non-local/);

    process.env.DATABASE_URL = "postgresql://localhost/x?host=db.example.com";
    assert.throws(() => createSeedClient(), /"host" query parameter/);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
