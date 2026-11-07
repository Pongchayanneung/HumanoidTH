import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The guard runs before any database work, so these URLs must be refused without touching a database.
const refused: Array<[string, string]> = [
  ["postgresql://u@localhost:5432?host=evil.example.com", "no database name"],
  ["postgresql://u@localhost:5432/?hostaddr=1.2.3.4", "no database name"],
  ["postgresql://u@localhost:5432/db?host=evil.example.com", "host="],
  ["postgresql://u@localhost:5432/db?hostaddr=1.2.3.4", "hostaddr="],
  ["postgresql://u@evil.example.com:5432/db", "not localhost"],
];

for (const [url, why] of refused) {
  test(`m7 guard refuses ${url}`, () => {
    const r = spawnSync("bash", ["scripts/m7-baseline-check.sh"], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /REFUSED/);
    assert.ok(r.stderr.includes(why), r.stderr);
  });
}
