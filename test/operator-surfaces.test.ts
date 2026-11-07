import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Execute real page components while replacing Next's request context. Any
// business dependency import is an error, so denied pages cannot hide DB reads.
function loadPage(file: string, lang = "en", session: unknown = { ok: false, code: "UNAUTHENTICATED" }, pending = false) {
  const source = readFileSync(resolve(file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  } }).outputText;
  const module = { exports: {} as any };
  runInNewContext(output, { module, exports: module.exports, require(name: string) {
    if (name === "next/headers") return { cookies: async () => ({ get: (key: string) => key === "lang" ? { value: lang } : undefined }) };
    if (name === "next/navigation") return { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } };
    if (name === "@/lib/operator-auth/web") return { getOperatorPrincipal: async () => session };
    if (name === "@/app/actions") return { logoutUser: async () => {} };
    if (name === "@/lib/translations") return require("../lib/translations.ts");
    if (name === "./AdminLoginForm") return { __esModule: true, default: loadPage("app/admin-login/AdminLoginForm.tsx", lang, session, pending) };
    if (name === "react-dom") return { useFormStatus: () => ({ pending }) };
    if (name === "react" || name === "lucide-react" || name === "react/jsx-runtime" || name === "next/link") return require(name);
    throw new Error(`Forbidden dependency in contained surface: ${name}`);
  } }, { filename: file });
  return module.exports.default;
}

for (const page of ["profile", "submit-data", "data-pulls", "map"]) {
  for (const lang of ["en", "th"]) test(`${page} ${lang} renders unavailable without business dependencies or forms`, async () => {
    const Page = loadPage(`app/${page}/page.tsx`, lang);
    const html = renderToStaticMarkup(await Page());
    assert.match(html, lang === "en" ? /unavailable/i : /ยังไม่เปิดให้ใช้งาน/);
    assert.doesNotMatch(html, /<form|<input|<table/);
  });
}

test("anonymous administrator is redirected before business dependencies", async () => {
  const Page = loadPage("app/admin/AdminConsolePage.tsx");
  await assert.rejects(() => Page({ searchParams: Promise.resolve({}) }), /REDIRECT:\/admin-login/);
});

test("unavailable administrator shows a deliberate state without a login assertion", async () => {
  const Page = loadPage("app/admin/AdminConsolePage.tsx", "en", { ok: false, code: "UNAVAILABLE" });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.match(html, /unavailable/i);
  assert.doesNotMatch(html, /verified session/i);
});

test("verified operator sees session only, with logout and no inspection/editor", async () => {
  const Page = loadPage("app/admin/AdminConsolePage.tsx", "en", { ok: true, principal: { kind: "operator", email: "operator@example.invalid" } });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: "unavailable" }) }));
  assert.match(html, /Verified session/);
  assert.match(html, /operator@example.invalid/);
  assert.match(html, /Sign out/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /<input|<table|Approve|Review queue/);
});

test("login offers accessible credentials without a caller-controlled redirect", async () => {
  const Page = loadPage("app/admin-login/page.tsx");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ from: "https://example.invalid/" }) }));
  assert.match(html, /autoComplete="username"/);
  assert.match(html, /autoComplete="current-password"/);
  assert.doesNotMatch(html, /name="from"|creativelab/);
});

for (const [code, expected] of [
  ["invalid_credentials", /Email or password is incorrect/],
  ["throttled", /Too many sign-in attempts/],
  ["unavailable", /Sign-in is unavailable/],
  ["forbidden_origin", /Open the configured site/]
] as const) test(`login explains ${code} with an associated alert`, async () => {
  const Page = loadPage("app/admin-login/page.tsx");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: code }) }));
  assert.match(html, expected);
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-describedby="login-error"/);
});

test("Thai login errors and pending state are localized and submission is disabled", async () => {
  const Page = loadPage("app/admin-login/page.tsx", "th", undefined, true);
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: "invalid_credentials" }) }));
  assert.match(html, /อีเมลหรือรหัสผ่านไม่ถูกต้อง/);
  assert.match(html, /กำลังเข้าสู่ระบบ/);
  assert.match(html, /disabled="" aria-busy="true"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /role="status"/);
});

test("unrecognized error input never becomes reflected login output", async () => {
  const Page = loadPage("app/admin-login/page.tsx", "untrusted-language");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: "private-database-error" }) }));
  assert.match(html, /Sign-in is unavailable/);
  assert.doesNotMatch(html, /private-database-error/);
});

for (const error of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
  test(`inherited error key ${error} renders the generic login error`, async () => {
    const Page = loadPage("app/admin-login/page.tsx");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error }) }));
    assert.match(html, /Sign-in is unavailable right now/);
    assert.match(html, /role="alert"/);
  });
}
