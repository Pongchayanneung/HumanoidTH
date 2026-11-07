import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkManifestChecksums,
  checkNoClientReferences,
  checkNoReleaseUnderPublic,
  checkNoSecretsInPublic,
  checkRequiredScripts,
  isSecretLikeName,
  runAllChecks
} from "../scripts/f9-handoff-check";

function put(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "f9-"));
  const doc = "[]";
  put(root, "data/search/documents.json", doc);
  put(
    root,
    "data/search/manifest.json",
    JSON.stringify({
      releaseId: "r1",
      fileChecksums: {
        "documents.json": { sha256: createHash("sha256").update(doc).digest("hex"), bytes: doc.length }
      }
    })
  );
  put(root, "package.json", JSON.stringify({ scripts: { typecheck: "x", test: "x", build: "x" } }));
  put(root, "app/page.tsx", "export default function P(){return null}");
  put(root, "public/logo.svg", "<svg/>");
  return root;
}

test("clean tree passes all checks", () => {
  const root = makeTree();
  try {
    const results = runAllChecks(root);
    assert.ok(results.every((r) => r.passed), JSON.stringify(results));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checksum mismatch is detected", () => {
  const root = makeTree();
  try {
    put(root, "data/search/documents.json", "[1]");
    const r = checkManifestChecksums(join(root, "data", "search"));
    assert.equal(r.passed, false);
    assert.match(r.detail, /documents\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release file under public/ is detected", () => {
  const root = makeTree();
  try {
    put(root, "public/search/documents.json", "[]");
    const r = checkNoReleaseUnderPublic(root);
    assert.equal(r.passed, false);
    assert.match(r.detail, /public/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("client reference to data/search is detected", () => {
  const root = makeTree();
  try {
    put(root, "components/x.tsx", 'import d from "../data/search/documents.json";');
    assert.equal(checkNoClientReferences(root).passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret-like names under public/ are detected", () => {
  assert.equal(isSecretLikeName(".env.local"), true);
  assert.equal(isSecretLikeName("key.pem"), true);
  assert.equal(isSecretLikeName("logo.svg"), false);
  const root = makeTree();
  try {
    put(root, "public/my-token.txt", "x");
    const r = checkNoSecretsInPublic(root);
    assert.equal(r.passed, false);
    assert.match(r.detail, /my-token/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing required script is reported", () => {
  const root = makeTree();
  try {
    put(root, "package.json", JSON.stringify({ scripts: { test: "x" } }));
    const r = checkRequiredScripts(root);
    assert.equal(r.passed, false);
    assert.match(r.detail, /typecheck/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
