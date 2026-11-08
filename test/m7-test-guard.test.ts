import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertM7Disposable, isUniqueViolation } from "../lib/m7-test-guard";

test("M7 requires explicit confirmation and a dedicated database name", () => {
  const env = { M7_DISPOSABLE_DATABASE: "yes" };
  assert.doesNotThrow(() => assertM7Disposable("postgresql://localhost/m7_disposable_123", env));
  assert.throws(() => assertM7Disposable("postgresql://localhost/m7_disposable_123", {}));
  assert.throws(() => assertM7Disposable("postgresql://localhost/production", env));
});

test("only Prisma unique violations satisfy the duplicate check", () => {
  assert.equal(isUniqueViolation({ code: "P2002" }), true);
  assert.equal(isUniqueViolation({ code: "P1001" }), false);
  assert.equal(isUniqueViolation(new Error("connection lost")), false);
  assert.equal(isUniqueViolation(null), false);
});
