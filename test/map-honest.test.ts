import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("map action denies requests without network access or a database", async () => {
  assert.equal(process.env.GEMINI_API_KEY, undefined);
  assert.equal(process.env.DATABASE_URL, undefined);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected network request");
  };
  try {
    const actions = await import("../app/map/actions");
    assert.deepEqual(Object.keys(actions), ["reanalyzeClustersWithGemini"]);
    assert.deepEqual(await actions.reanalyzeClustersWithGemini(), { status: "disabled" });
    const forged = actions.reanalyzeClustersWithGemini as (...args: unknown[]) => Promise<unknown>;
    assert.deepEqual(await forged("admin", { role: "ADMIN" }), { status: "disabled" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("map server sources contain no generation or database path", () => {
  for (const path of ["app/map/actions.ts", "app/map/page.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /fetch\s*\(|generativelanguage|GEMINI|prisma|statsCache|revalidatePath|kmutt_fibo|Dinsaw/, path);
  }
});
