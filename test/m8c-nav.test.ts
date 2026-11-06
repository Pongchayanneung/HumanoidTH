import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { translations } from "../lib/translations";

const read = (path: string) => readFileSync(path, "utf8");

test("U1: translations have matching keys and navigation copy", () => {
  assert.deepEqual(Object.keys(translations.en).sort(), Object.keys(translations.th).sort());
  for (const lang of [translations.en, translations.th]) {
    for (const key of ["sourceLink", "opensInNewTab", "robotsEmpty", "robotsUnavailable", "robotsLimitNote"] as const) assert.ok(lang[key].trim());
  }
});
test("U2: mobile tabs include contributions", () => {
  const source = read("app/components/MobileTabNav.tsx");
  assert.match(source, /href: "\/contributions"/);
  assert.doesNotMatch(source, /href: "\/profile"/);
  assert.equal((source.match(/href: "[^\"]+"/g) ?? []).length, 5);
});
test("U3: mobile header has language and named profile controls", () => {
  const source = read("app/components/MobileHeader.tsx");
  assert.match(source, /<LanguageSelector\s+currentLang=\{currentLang\}/);
  assert.match(source, /<Link\s+href="\/profile"[^>]*aria-label=/);
  assert.match(read("app/layout.tsx"), /<MobileHeader\s+currentLang=\{lang\}/);
});
test("U4: layout does not cast the language cookie", () => {
  assert.doesNotMatch(read("app/layout.tsx"), /as\s+"en"\s*\|\s*"th"/);
});
test("U5: focus and Thai label styles", () => {
  const css = read("app/globals.css");
  assert.match(css, /--focus-ring-dark:\s*#d6be67/);
  assert.doesNotMatch(css, /\.nav a:focus(?!-visible)/);
  assert.match(css, /html\[lang="th"\] \.tab-label/);
});
test("U6: robot list uses its named limit without seed instructions", () => {
  const source = read("app/robots/page.tsx");
  assert.doesNotMatch(source, /pnpm db:seed/);
  assert.match(source, /take:\s*ROBOT_LIST_LIMIT/);
});
