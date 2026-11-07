import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { collections, createInspectionFixture, createdAt, excluded, oldestId, updatedAt } from "./admin-inspection-fixture";
import { businessSnapshot, operatorEmail, operatorPassword } from "./fixture";

test("direct inspection checks real session authority before reading a business record", {
  skip: process.env.ISSUE4_AUTH_ACCEPTANCE !== "1",
  timeout: 60_000
}, async () => {
  const fixture = await createInspectionFixture();
  try {
    const before = await businessSnapshot(fixture.sql);
    const script = `
      import assert from "node:assert/strict";
      import { mock } from "node:test";

      // Replace the request cookie source only. Both storage observers call the
      // real implementations against the freshly migrated local database.
      let token;
      mock.module("next/headers", { namedExports: {
        cookies: async () => ({
          get(name) { return name === "operator_session_dev" ? { value: token } : undefined; }
        })
      } });
      const repositoryUrl = new URL("./lib/admin-inspection/postgres-repository.ts", import.meta.url);
      const authStoreUrl = new URL("./lib/operator-auth/postgres-store.ts", import.meta.url);
      const business = await import(repositoryUrl.href);
      const auth = await import(authStoreUrl.href);
      const businessReads = [];
      let authReads = 0;
      mock.module(repositoryUrl, { namedExports: {
        createPostgresInspectionRepository(client) {
          const repository = business.createPostgresInspectionRepository(client);
          return {
            findExact(collection, id) {
              businessReads.push([collection, id]);
              return repository.findExact(collection, id);
            }
          };
        }
      } });
      mock.module(authStoreUrl, { namedExports: {
        createPostgresAuthStore(client) {
          const store = auth.createPostgresAuthStore(client);
          return { ...store, readSession(input) { authReads++; return store.readSession(input); } };
        }
      } });
      const { inspectCmsRecord } = await import("./lib/admin-inspection/index.ts");
      const { runtimeOperatorAuth } = await import("./lib/operator-auth/runtime.ts");
      const oldestId = ${JSON.stringify(oldestId)};
      const poison = new Proxy({}, { get() { throw Error("Unexpected selector access"); } });
      const valid = { collection: "source-records", selectedId: oldestId };
      const unauthorized = { ok: false, code: "UNAUTHENTICATED" };
      const invalid = { ok: false, code: "INVALID_SELECTION" };

      assert.deepEqual(await inspectCmsRecord(poison), unauthorized);
      assert.equal(authReads, 0);
      assert.deepEqual(businessReads, []);
      token = "0".repeat(64);
      assert.deepEqual(await inspectCmsRecord(valid), unauthorized);
      assert.equal(authReads, 1);
      assert.deepEqual(businessReads, []);
      process.stdout.write("anonymous and forged denial verified\\n");

      const login = await runtimeOperatorAuth.loginOperator(${JSON.stringify({ email: operatorEmail, password: operatorPassword })});
      assert.equal(login.ok, true);
      token = login.token;
      for (const input of [
        { ...valid, selectedId: [oldestId, oldestId] },
        { ...valid, selectedId: Object.create({ toString: () => oldestId }) },
        { ...valid, selectedId: "ก".repeat(86) },
        { ...valid, selectedId: "embedded\\u0000control" },
        { ...valid, collection: ["source-records", "source-records"] },
        { ...valid, collection: "constructor" },
        { ...valid, collection: "__proto__" }
      ]) {
        const beforeAuthReads = authReads;
        assert.deepEqual(await inspectCmsRecord(input), invalid);
        assert.equal(authReads, beforeAuthReads + 1);
        assert.deepEqual(businessReads, []);
      }
      process.stdout.write("invalid input denial verified\\n");

      for (const item of ${JSON.stringify(collections.map(({ name, title, status }) => ({ name, title, status })))}) {
        const result = await inspectCmsRecord({ collection: item.name, selectedId: oldestId });
        assert.equal(result.ok, true);
        assert.equal(result.record.collection, item.name);
        assert.equal(result.record.id, oldestId);
        assert.equal(result.record.displayName, item.title);
        assert.equal(result.record.status, item.name === "robot-models" ? null : item.status);
        assert.equal(result.record.createdAt, ${JSON.stringify(createdAt)});
        assert.equal(result.record.updatedAt, ${JSON.stringify(updatedAt)});
        for (const sentinel of ${JSON.stringify(Object.values(excluded))}) assert.equal(JSON.stringify(result).includes(sentinel), false);
      }
      assert.deepEqual(businessReads, ${JSON.stringify(collections.map(({ name }) => [name, oldestId]))});
      assert.deepEqual(await runtimeOperatorAuth.revokeOperatorSession(token), { ok: true });
      assert.deepEqual(await inspectCmsRecord(valid), unauthorized);
      assert.equal(businessReads.length, 4);
      process.stdout.write("exact lookups and revoked replay verified\\n");
    `;
    const child = spawnSync(process.execPath, [
      "--conditions=react-server", "--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning",
      "--import", "tsx", "--input-type=module", "-e", script
    ], {
      cwd: process.cwd(),
      env: { ...process.env, ...fixture.environment },
      encoding: "utf8",
      timeout: 30_000
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, `Direct inspection subprocess failed. Completed checks: ${child.stdout || "(none)"}`);
    assert.equal(await businessSnapshot(fixture.sql), before);
  } finally {
    await fixture.sql.end();
  }
});
