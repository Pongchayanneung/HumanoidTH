import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SessionResult } from "../lib/operator-auth/contracts";
import type { CmsCollection, InspectionInput, InspectionRecord } from "../lib/admin-inspection/contracts";
import { createInspectionService } from "../lib/admin-inspection/service";

const authorized: SessionResult = { ok: true, principal: { kind: "operator", email: "operator@example.invalid" } };
const unavailable = { ok: false, code: "UNAVAILABLE" } as const;
const unauthenticated = { ok: false, code: "UNAUTHENTICATED" } as const;
const invalid = { ok: false, code: "INVALID_SELECTION" };
const opaqueId = "  Legacy-R2-🤖  ";

function record(collection: CmsCollection, id = opaqueId): InspectionRecord {
  return {
    collection,
    id,
    displayName: "Synthetic robot",
    summary: null,
    status: null,
    url: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z"
  };
}

test("denied and unavailable auth return before reading selectors or creating a repository", async () => {
  for (const [authorize, result] of [
    [async () => unauthenticated, unauthenticated],
    [async () => unavailable, unavailable],
    [async () => { throw new Error("sensitive auth failure"); }, unavailable]
  ] as const) {
    let reads = 0;
    let repositories = 0;
    const input = new Proxy({} as InspectionInput, {
      get() { reads++; throw new Error("input getter"); },
      getOwnPropertyDescriptor() { reads++; throw new Error("input own key"); }
    });
    const { inspectCmsRecord } = createInspectionService({
      authorize,
      repository: async () => { repositories++; throw new Error("repository"); }
    });
    assert.deepEqual(await inspectCmsRecord(input), result);
    assert.equal(reads, 0);
    assert.equal(repositories, 0);
  }
});

test("malformed selectors never initialize business storage", async () => {
  let repositories = 0;
  const { inspectCmsRecord } = createInspectionService({
    authorize: async () => authorized,
    repository: async () => { repositories++; throw new Error("repository"); }
  });
  for (const collection of [
    "", "sourceRecords", "SOURCE-RECORDS", " source-records", "__proto__", "constructor", "toString",
    ["source-records"], ["source-records", "source-records"], 3, null, undefined, { toString: () => "source-records" }
  ]) {
    assert.deepEqual(await inspectCmsRecord({ collection, selectedId: opaqueId }), invalid);
  }
  for (const selectedId of [
    "", " ", "\u00a0", "new", "\u0000x", "x\ny", "x\u007fy", "x\u0085y", "\ud800", "\udfff",
    "x".repeat(257), "ก".repeat(86), ["a"], ["a", "a"], 3, true, null, undefined,
    { toString: () => "a" }, new String("a")
  ]) {
    assert.deepEqual(await inspectCmsRecord({ collection: "source-records", selectedId }), invalid);
  }
  assert.deepEqual(await inspectCmsRecord(Object.create({ collection: "source-records", selectedId: opaqueId })), invalid);
  assert.deepEqual(await inspectCmsRecord(null as unknown as InspectionInput), invalid);
  assert.deepEqual(await inspectCmsRecord({
    collection: "source-records",
    get selectedId() { throw new Error("sensitive selector failure"); }
  }), invalid);
  assert.equal(repositories, 0);
});

test("all collections preserve the exact case, whitespace and UTF-8 ID boundary", async () => {
  const collections = ["source-records", "robot-models", "contributions", "submitted-data"] as const;
  const calls: [CmsCollection, string][] = [];
  const { inspectCmsRecord } = createInspectionService({
    authorize: async () => authorized,
    repository: async () => ({
      async findExact(collection, id) {
        calls.push([collection, id]);
        return record(collection, id);
      }
    })
  });
  const exactBoundary = "ก".repeat(84) + "🤖";
  for (const collection of collections) {
    for (const id of [opaqueId, exactBoundary]) {
      assert.deepEqual(await inspectCmsRecord({ collection, selectedId: id }), { ok: true, record: record(collection, id) });
    }
  }
  assert.deepEqual(calls, collections.flatMap(collection => [[collection, opaqueId], [collection, exactBoundary]]));
});

test("every invocation checks fresh authorization before a lookup", async () => {
  let session: SessionResult = authorized;
  let authChecks = 0;
  let lookups = 0;
  const { inspectCmsRecord } = createInspectionService({
    authorize: async () => { authChecks++; return session; },
    repository: async () => ({
      async findExact() { lookups++; return record("robot-models"); }
    })
  });
  const input = { collection: "robot-models", selectedId: opaqueId };
  assert.deepEqual(await inspectCmsRecord(input), { ok: true, record: record("robot-models") });
  session = { ok: false, code: "UNAUTHENTICATED" };
  assert.deepEqual(await inspectCmsRecord(input), unauthenticated);
  assert.equal(authChecks, 2);
  assert.equal(lookups, 1);
});

test("missing records and storage exceptions have distinct, token-free results", async () => {
  const input = { collection: "contributions", selectedId: "missing" };
  const error = new Error("sensitive database failure");
  for (const [repository, result] of [
    [async () => ({ findExact: async () => null }), { ok: false, code: "NOT_FOUND" }],
    [async () => { throw error; }, unavailable],
    [async () => ({ findExact: async () => { throw error; } }), unavailable]
  ] as const) {
    const { inspectCmsRecord } = createInspectionService({ authorize: async () => authorized, repository });
    assert.deepEqual(await inspectCmsRecord(input), result);
  }
});

test("the service refuses a repository record with a different ID or collection", async () => {
  const input = { collection: "contributions", selectedId: opaqueId };
  for (const other of [record("source-records"), record("contributions", opaqueId.trim())]) {
    const { inspectCmsRecord } = createInspectionService({
      authorize: async () => authorized,
      repository: async () => ({ findExact: async () => other })
    });
    assert.deepEqual(await inspectCmsRecord(input), unavailable);
  }
});

test("a fresh process imports and calls the real inspector without config or generated storage", () => {
  const cwd = mkdtempSync(join(tmpdir(), "hri-inspection-import-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
    for (const key of Object.keys(env)) {
      if (/^(DATABASE_URL$|OPERATOR_)/i.test(key)) delete env[key];
    }
    const inspector = new URL("../lib/admin-inspection/index.ts", import.meta.url).href;
    const prisma = new URL("../generated/prisma/index.js", import.meta.url);
    const child = spawnSync(process.execPath, [
      "--conditions=react-server", "--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import { createRequire } from 'node:module';
        import { fileURLToPath } from 'node:url';
        const require = createRequire(${JSON.stringify(inspector)});
        const { inspectCmsRecord } = await import(${JSON.stringify(inspector)});
        const input = new Proxy({}, { get() { throw Error('Unexpected selector read'); } });
        assert.deepEqual(await inspectCmsRecord(input), { ok: false, code: 'UNAVAILABLE' });
        const prismaPath = fileURLToPath(${JSON.stringify(prisma.href)});
        assert.equal(require.cache[require.resolve(prismaPath)], undefined);
      `
    ], { cwd, env, encoding: "utf8", timeout: 20_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr || "Fresh-process inspection failed");
  } finally {
    rmdirSync(cwd);
  }
});
