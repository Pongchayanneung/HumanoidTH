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
test("U2: the shared drawer includes contributions and public sources", () => {
  const source = read("app/components/AtlasNavigation.tsx");
  assert.match(source, /\["\/contributions", "Research contributions", "ผลงานวิจัย"\]/);
  assert.match(source, /\["\/sources", "Sources", "แหล่งข้อมูล"\]/);
});
test("U3: the shared header provides a language switch and a named drawer button", () => {
  const source = read("app/components/AtlasNavigation.tsx");
  assert.match(source, /<LanguageSelector\s+currentLang=\{lang\}/);
  assert.match(source, /aria-label=\{thai \? "เปิดเมนู" : "Open navigation"\}/);
  assert.match(read("app/layout.tsx"), /<AtlasNavigation\s+lang=\{lang\}/);
});
test("U4: layout does not cast the language cookie", () => {
  assert.doesNotMatch(read("app/layout.tsx"), /as\s+"en"\s*\|\s*"th"/);
});
test("U5: the drawer styles retain visible keyboard focus", () => {
  const css = read("app/components/AtlasNavigation.module.css");
  assert.match(css, /\.drawer a:focus-visible\s*\{\s*outline:\s*2px solid/);
});
test("U6: robot list uses its named limit without seed instructions", () => {
  const source = read("app/robots/page.tsx");
  assert.doesNotMatch(source, /pnpm db:seed/);
  assert.match(source, /take:\s*selected \? 1 : ROBOT_LIST_LIMIT/);
});
test("U7: later FAB override does not set position offsets", () => {
  const rule = read("app/globals.css").match(/\/\* Custom FAB Button Override \*\/\s*\.data-pull-fab\s*\{([^}]*)\}/);
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /(?:^|;)\s*(?:bottom|right)\s*:/);
});
test("U8: drawer labels are rendered in the selected language", () => {
  assert.match(read("app/components/AtlasNavigation.tsx"), /\{thai \? th : en\}/);
});
test("U9: drawer marks only the exact current page with aria-current", () => {
  assert.match(read("app/components/AtlasNavigation.tsx"), /aria-current=\{href === pathname \? "page" : undefined\}/);
});
