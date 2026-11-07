import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("map action denies requests without network access or a database", async () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected network request");
  };
  try {
    const actions = await import("../app/map/actions");
    assert.deepEqual(Object.keys(actions).sort(), ["analyzeClustersWithGemini", "fetchContributionClusters", "reanalyzeClustersWithGemini"]);
    assert.deepEqual(await actions.analyzeClustersWithGemini(), { ok: false, code: "WORKFLOW_UNAVAILABLE" });
    assert.deepEqual(await actions.fetchContributionClusters(), []);
    assert.deepEqual(await actions.reanalyzeClustersWithGemini(), { ok: false, code: "WORKFLOW_UNAVAILABLE" });
    const forged = actions.reanalyzeClustersWithGemini as (...args: unknown[]) => Promise<unknown>;
    assert.deepEqual(await forged("admin", { role: "ADMIN" }), { ok: false, code: "WORKFLOW_UNAVAILABLE" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("map server sources contain no generation or database path", () => {
  for (const path of ["app/map/actions.ts", "app/map/page.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /fetch\s*\(|generativelanguage|GEMINI|prisma|statsCache|revalidatePath|kmutt_fibo|Dinsaw/, path);
    if (path === "app/map/actions.ts") {
      assert.doesNotMatch(source, /process\.env|next\/cache|next\/headers/, path);
    }
  }
});
