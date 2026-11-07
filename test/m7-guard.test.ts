import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const explicitBash = process.env.ATLAS_TEST_BASH;
// Windows may resolve bare `bash` to the WSL launcher.
const skipBash = process.platform === "win32" && !explicitBash &&
  "Set ATLAS_TEST_BASH to the path to Git Bash to run these guard checks.";

// The guard runs before any database work, so these URLs must be refused without touching a database.
const refused: Array<[string, string]> = [
  ["postgresql://u@localhost:5432?host=evil.example.com", "no database name"],
  ["postgresql://u@localhost:5432/?hostaddr=1.2.3.4", "no database name"],
  ["postgresql://u@localhost:5432/db?host=evil.example.com", "host="],
  ["postgresql://u@localhost:5432/db?hostaddr=1.2.3.4", "hostaddr="],
  ["postgresql://u@evil.example.com:5432/db", "not localhost"],
  ["postgresql://u@localhost:5432/db%0A?host=evil.example.com", "control character"],
  ["postgresql://u@localhost:5432/db%1F?hostaddr=1.2.3.4", "control character"],
];

for (const [url, why] of refused) {
  test(`m7 guard refuses ${url}`, { skip: skipBash }, () => {
    const r = spawnSync(explicitBash || "bash", ["scripts/m7-baseline-check.sh"], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.ifError(r.error);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /REFUSED/);
    assert.ok(r.stderr.includes(why), r.stderr);
  });
}

test("m7 runner scopes the seed opt-in to the seed step only", () => {
  const script = readFileSync("scripts/m7-baseline-check.sh", "utf8");
  const lines = script.split("\n").filter((line) => line.includes("ATLAS_ALLOW_SEED"));
  assert.equal(lines.filter((line) => !line.trim().startsWith("#")).length, 1);
  assert.match(lines.find((line) => !line.trim().startsWith("#")) ?? "", /check seed \d+ env ATLAS_ALLOW_SEED=1 .*prisma\/seed\.ts/);
});
