import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { scratchBaseUrl } from "../test-integration/fixture";

test("the disposable PostgreSQL guard rejects driver overrides before connecting", t => {
  const names = ["ISSUE4_AUTH_ACCEPTANCE", "ISSUE4_TEST_DATABASE_URL", "PGHOST", "PGPORT"] as const;
  const previous = new Map(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  process.env.ISSUE4_AUTH_ACCEPTANCE = "1";
  const safe = "postgresql://fixture:synthetic@localhost:5544/postgres";
  for (const suffix of [
    "?host=remote.example.invalid&port=5432",
    "?host=%2Fvar%2Frun%2Fpostgresql",
    "?sslmode=require",
    "#ignored",
    "?",
    "#"
  ]) {
    process.env.ISSUE4_TEST_DATABASE_URL = safe + suffix;
    assert.throws(scratchBaseUrl, /query parameters or fragments/);
  }

  for (const value of [
    "postgresql://fixture:synthetic@localhost:5432/postgres",
    "postgresql://fixture:synthetic@remote.example.invalid:5544/postgres",
    "https://localhost:5544/postgres"
  ]) {
    process.env.ISSUE4_TEST_DATABASE_URL = value;
    assert.throws(scratchBaseUrl, /localhost:5544|native PostgreSQL/);
  }

  const require = createRequire(import.meta.url);
  const { Client } = require("pg") as {
    Client: new (config: { connectionString: string }) => {
      connectionParameters: { host: string; port: number };
    };
  };
  process.env.PGHOST = "remote.example.invalid";
  process.env.PGPORT = "5432";
  process.env.ISSUE4_TEST_DATABASE_URL = safe;
  const { host, port } = new Client({ connectionString: scratchBaseUrl() }).connectionParameters;
  assert.equal(host, "localhost");
  assert.equal(port, 5544);
});
