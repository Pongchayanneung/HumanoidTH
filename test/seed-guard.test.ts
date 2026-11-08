import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSeedAllowed } from "../lib/seed-guard";
import { assertM7Disposable } from "../lib/m7-test-guard";
import { loadEnvFile } from "../lib/load-env";

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
    "postgresql://0.0.0.0/x",
    // pg cannot dial the bracketed form (ENOTFOUND), so it is not a supported local host.
    "postgresql://postgres@[::1]:5432/x"
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

test("refuses whitespace, control characters and malformed percent escapes", () => {
  for (const url of [
    " postgresql://u@localhost/x",
    "postgresql://u@localhost/x\n",
    "postgresql://u@localhost/x?a=\tb",
    "postgresql://u@localhost/x?a=%zz"
  ]) {
    assert.throws(() => assertSeedAllowed(url, ON), /whitespace, control characters/, JSON.stringify(url));
  }
  // Well-formed escapes stay allowed.
  assert.doesNotThrow(() => assertSeedAllowed("postgresql://u:p%40ss@localhost/x?a=%2F", ON));
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
    "not a url hunter2pw",
    "postgresql://admin:hunter2pw@localhost/x?a=%zz",
    " postgresql://admin:hunter2pw@db.example.com/x"
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

// An env file must never satisfy the guard. The sentinel proves the file was
// actually read, so these cannot pass because the loader found nothing.
function withEnvFile(contents: string, run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "atlas-env-"));
  const path = join(dir, "flag.env");
  writeFileSync(path, contents);
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a flag in an env file is ignored and the guard still refuses", () => {
  withEnvFile("ATLAS_ALLOW_SEED=1\nM1_SENTINEL=loaded\n", (path) => {
    const env: Record<string, string | undefined> = {};
    loadEnvFile(env, path);
    assert.equal(env.M1_SENTINEL, "loaded", "env file was not read");
    assert.equal(env.ATLAS_ALLOW_SEED, undefined);
    assert.throws(() => assertSeedAllowed(LOCAL, env), /ATLAS_ALLOW_SEED=1/);
  });
});

test("an inline flag survives the loader and other keys keep no-override semantics", () => {
  withEnvFile("ATLAS_ALLOW_SEED=0\nM1_SENTINEL=loaded\nM1_KEEP=fromfile\n", (path) => {
    const env: Record<string, string | undefined> = { ATLAS_ALLOW_SEED: "1", M1_KEEP: "inline" };
    loadEnvFile(env, path);
    assert.equal(env.M1_SENTINEL, "loaded", "env file was not read");
    assert.equal(env.ATLAS_ALLOW_SEED, "1");
    assert.equal(env.M1_KEEP, "inline");
    assert.doesNotThrow(() => assertSeedAllowed(LOCAL, env));
  });
});

// Case-insensitive environments (Windows) fold atlas_allow_seed into ATLAS_ALLOW_SEED when
// copied into process.env. The target here is a plain object, so this check does not depend on
// the host OS: no copied key may uppercase to the flag name, whatever its spelling in the file.
test("a differently-cased flag spelling in an env file is not copied either", () => {
  withEnvFile("atlas_allow_seed=1\nAtlas_Allow_Seed=1\nM1_SENTINEL=loaded\n", (path) => {
    const env: Record<string, string | undefined> = {};
    loadEnvFile(env, path);
    assert.equal(env.M1_SENTINEL, "loaded", "env file was not read");
    assert.equal(
      Object.keys(env).some((key) => key.toUpperCase() === "ATLAS_ALLOW_SEED"),
      false,
      `flag spelling copied from file: ${Object.keys(env).join(", ")}`
    );
  });
});

test("neither flag loads from an env file, while a process-provided confirmation remains usable", () => {
  withEnvFile(
    "ATLAS_ALLOW_SEED=1\natlas_allow_seed=1\nM7_DISPOSABLE_DATABASE=yes\nm7_disposable_database=yes\nM1_SENTINEL=loaded\n",
    (path) => {
      const env: Record<string, string | undefined> = {};
      loadEnvFile(env, path);
      assert.equal(env.M1_SENTINEL, "loaded", "env file was not read");
      assert.equal(env.ATLAS_ALLOW_SEED, undefined);
      assert.equal(env.M7_DISPOSABLE_DATABASE, undefined);
      assert.equal(
        Object.keys(env).some(
          (key) => key.toUpperCase() === "ATLAS_ALLOW_SEED" || key.toUpperCase() === "M7_DISPOSABLE_DATABASE"
        ),
        false,
        `flag spelling copied from file: ${Object.keys(env).join(", ")}`
      );
      assert.throws(() => assertSeedAllowed(LOCAL, env), /ATLAS_ALLOW_SEED=1/);
      assert.throws(
        () => assertM7Disposable("postgresql://localhost/m7_disposable_123", env),
        /M7_DISPOSABLE_DATABASE=yes/
      );
    }
  );

  withEnvFile("ATLAS_ALLOW_SEED=0\nM7_DISPOSABLE_DATABASE=no\nM1_SENTINEL=loaded\n", (path) => {
    const env: Record<string, string | undefined> = {
      ATLAS_ALLOW_SEED: "1",
      M7_DISPOSABLE_DATABASE: "yes"
    };
    loadEnvFile(env, path);
    assert.equal(env.M1_SENTINEL, "loaded", "env file was not read");
    assert.equal(env.ATLAS_ALLOW_SEED, "1");
    assert.equal(env.M7_DISPOSABLE_DATABASE, "yes");
    assert.doesNotThrow(() => assertSeedAllowed(LOCAL, env));
    assert.doesNotThrow(() => assertM7Disposable("postgresql://localhost/m7_disposable_123", env));
  });
});
