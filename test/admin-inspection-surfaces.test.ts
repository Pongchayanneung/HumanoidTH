import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { renderToReadableStream } from "react-dom/server";
import ts from "typescript";

import type { InspectionInput, InspectionResult } from "@/lib/admin-inspection/contracts";
import type { SessionResult } from "../lib/operator-auth/contracts";

const require = createRequire(import.meta.url);
const operator: SessionResult = { ok: true, principal: { kind: "operator", email: "operator@example.invalid" } };
const record: Extract<InspectionResult, { ok: true }>["record"] = {
  collection: "source-records",
  id: "exact-Aa-007",
  displayName: "Exact fixture title",
  summary: "Fixture summary",
  status: "pending",
  url: "https://example.invalid/record",
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
};

type Query = Partial<Record<string, string | string[]>>;
type Options = {
  lang?: "en" | "th";
  authorize?: () => Promise<SessionResult>;
  inspect?: (input: InspectionInput) => Promise<InspectionResult>;
};

// Execute the real route wrappers and JSX with an isolated Next request context.
// The service seam lets the UI tests run without a database or a Next server.
async function renderRoute(route: "" | "/cms" | "/submitted-data", searchParams: Promise<Query>, {
  lang = "en",
  authorize = async () => operator,
  inspect = async () => assert.fail("The inspector must not run"),
}: Options = {}) {
  function load(file: string) {
    const source = readFileSync(file, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const module = { exports: {} };
    runInNewContext(output, { module, exports: module.exports, require(name: string) {
      switch (name) {
        case "next/headers": return { cookies: async () => ({ get: () => ({ value: lang }) }) };
        case "next/navigation": return { redirect: (path: string) => { throw new Error("REDIRECT:" + path); } };
        case "@/lib/operator-auth/web": return { getOperatorPrincipal: authorize };
        case "@/lib/admin-inspection": return { inspectCmsRecord: inspect };
        case "@/app/actions": return { logoutUser: async () => {} };
        case "./AdminConsolePage":
        case "../AdminConsolePage": return load("app/admin/AdminConsolePage.tsx");
        case "./ReadOnlyRecordView": return load("app/admin/ReadOnlyRecordView.tsx");
        case "next/link":
        case "react/jsx-runtime": return require(name);
        default: throw new Error("Unexpected admin UI dependency: " + name);
      }
    } }, { filename: file });
    return module.exports as { default: (props: { searchParams: Promise<Query> }) => React.ReactElement };
  }

  const Page = load("app/admin" + route + "/page.tsx").default;
  const stream = await renderToReadableStream(await Page({ searchParams }), { onError() {} });
  return new Response(stream).text();
}

test("a verified landing offers labelled native GET controls and sign-out without inspecting", async () => {
  const html = await renderRoute("", Promise.resolve({ error: "private-error-detail" }));
  assert.match(html, /Verified session/);
  assert.match(html, /operator@example.invalid/);
  assert.match(html, /Sign out/);
  assert.match(html, /Sign-out could not be completed/);
  assert.match(html, /<form [^>]*method="get"[^>]*>/i);
  assert.match(html, /<label for="inspection-collection">[^<]+<\/label>/);
  assert.match(html, /<label for="inspection-id">[^<]+<\/label>/);
  assert.match(html, /<select [^>]*id="inspection-collection"[^>]*name="collection"/);
  assert.match(html, /<input [^>]*id="inspection-id"[^>]*name="selectedId"/);
  assert.match(html, /<button type="submit"[^>]*>Inspect record<\/button>/);
  assert.match(html, /Editing, review, publication and ingestion remain unavailable/);
  assert.doesNotMatch(html, /private-error-detail|<(textarea|table)|<button[^>]*>(Approve|Publish|Edit)/);
  assert.equal((html.match(/<form\b/g) ?? []).length, 2);
});

for (const route of ["", "/cms", "/submitted-data"] as const) {
  test("the " + (route || "/admin") + " route denies before reading query params", async () => {
    const searchParams = { then: () => assert.fail("Query read before authorization") } as unknown as Promise<Query>;
    await assert.rejects(renderRoute(route, searchParams, {
      authorize: async () => ({ ok: false, code: "UNAUTHENTICATED" }),
    }), /REDIRECT:\/admin-login/);

    const html = await renderRoute(route, searchParams, {
      authorize: async () => ({ ok: false, code: "UNAVAILABLE" }),
    });
    assert.match(html, /Authentication unavailable/);
    assert.doesNotMatch(html, /Verified session|name="selectedId"|Sign out/);
  });

  test("the " + (route || "/admin") + " route renders the exact returned record", async () => {
    const collection = route === "/submitted-data" ? "submitted-data" : "source-records";
    const selectedId = record.id;
    const query = route === "/submitted-data" ? { selectedId } : { collection, selectedId };
    const html = await renderRoute(route, Promise.resolve(query), {
      inspect: async (input) => {
        assert.equal(input.collection, collection);
        assert.equal(input.selectedId, selectedId);
        return { ok: true, record: { ...record, collection } };
      },
    });
    assert.match(html, />exact-Aa-007</);
    assert.match(html, />Exact fixture title</);
    assert.match(html, />pending</);
    assert.doesNotMatch(html, /href="https:\/\/example.invalid\/record"/);
  });
}

test("bare aliases remain verified landings without implicit selection", async () => {
  const cms = await renderRoute("/cms", Promise.resolve({}));
  const submitted = await renderRoute("/submitted-data", Promise.resolve({}));
  assert.match(cms, /Verified session/);
  assert.match(submitted, /Verified session/);
  assert.doesNotMatch(submitted, /<select\b/);
});

test("the CMS alias forwards repeated and partial query values for rejection", async () => {
  const collection = ["source-records", "source-records"];
  const selectedId = ["secret-hostile-id", "another-id"];
  for (const params of [{ collection, selectedId }, { collection }]) {
    const html = await renderRoute("/cms", Promise.resolve(params), {
      inspect: async (input) => {
        assert.equal(input.collection, collection);
        assert.equal(input.selectedId, params.selectedId);
        return { ok: false, code: "INVALID_SELECTION" };
      },
    });
    assert.match(html, /Invalid selection/);
    assert.doesNotMatch(html, /secret-hostile-id|another-id|Exact fixture title/);
  }
});

test("the submitted alias cannot reinterpret an explicit collection as a different record", async () => {
  for (const collection of ["robot-models", ["submitted-data", "submitted-data"], ""]) {
    const html = await renderRoute("/submitted-data", Promise.resolve({ collection, selectedId: record.id }), {
      inspect: async (input) => {
        assert.notEqual(input.collection, "submitted-data");
        assert.notEqual(input.collection, "robot-models");
        return { ok: false, code: "INVALID_SELECTION" };
      },
    });
    assert.match(html, /Invalid selection/);
    assert.doesNotMatch(html, /Exact fixture title/);
  }
});

test("the submitted alias forwards a repeated ID for rejection", async () => {
  const selectedId = ["secret-hostile-id", "second-id"];
  const html = await renderRoute("/submitted-data", Promise.resolve({ selectedId }), {
    inspect: async (input) => {
      assert.equal(input.collection, "submitted-data");
      assert.equal(input.selectedId, selectedId);
      return { ok: false, code: "INVALID_SELECTION" };
    },
  });
  assert.match(html, /Invalid selection/);
  assert.doesNotMatch(html, /secret-hostile-id|second-id/);
});

for (const [code, english, thai] of [
  ["INVALID_SELECTION", /Invalid selection/, /การเลือกไม่ถูกต้อง/],
  ["NOT_FOUND", /Record not found/, /ไม่พบระเบียน/],
  ["UNAVAILABLE", /Inspection unavailable/, /การตรวจดูข้อมูลยังไม่พร้อมใช้งาน/],
] as const) {
  test(code + " yields distinct localized feedback without displaying a substitute", async () => {
    for (const lang of ["en", "th"] as const) {
      const html = await renderRoute("", Promise.resolve({ collection: "source-records", selectedId: "private-invalid-value" }), {
        lang,
        inspect: async () => ({ ok: false, code }),
      });
      assert.match(html, lang === "th" ? thai : english);
      if (code === "INVALID_SELECTION") {
        assert.match(html, /id="inspection-error"/);
        assert.match(html, /aria-invalid="true"/);
        assert.match(html, /aria-describedby="[^"]*inspection-error/);
      }
      assert.doesNotMatch(html, /private-invalid-value|Exact fixture title/);
    }
  });
}

test("a fresh service denial redirects even after a successful page session check", async () => {
  await assert.rejects(renderRoute("", Promise.resolve({ collection: "source-records", selectedId: record.id }), {
    inspect: async () => ({ ok: false, code: "UNAUTHENTICATED" }),
  }), /REDIRECT:\/admin-login/);
});

test("hostile stored content is escaped and long content is clipped by Unicode code point", async () => {
  const title = '<img src=x onerror="alert(1)">';
  const url = "javascript:alert(1)";
  const longId = "exact-" + "Z".repeat(250);
  const text = "\u{1F916}".repeat(4096);
  const html = await renderRoute("", Promise.resolve({ collection: "source-records", selectedId: longId }), {
    inspect: async () => ({
      ok: true,
      record: { ...record, id: longId, displayName: title, summary: text + "OMITTED", url },
    }),
  });
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, />javascript:alert\(1\)</);
  assert.ok(html.includes(">" + longId + "<"));
  assert.equal((html.match(/\u{1F916}/gu) ?? []).length, 4096);
  assert.match(html, /Display truncated/);
  assert.doesNotMatch(html, /<img\b|href="javascript:|OMITTED/);
});
