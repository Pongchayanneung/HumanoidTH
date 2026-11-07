import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("language button names contain their visible labels", () => {
  const source = readFileSync("app/components/LanguageSelector.tsx", "utf8");
  const buttons = [...source.matchAll(/<button\b[\s\S]*?<\/button>/g)];
  assert.equal(buttons.length, 2);
  for (const [index, visible] of ["EN", "TH"].entries()) {
    const name = buttons[index][0].match(/aria-label="([^"]+)"/)?.[1];
    assert.match(buttons[index][0], new RegExp(`<span className="lang-text">${visible}</span>`));
    assert.ok(name?.includes(visible), `accessible name must contain ${visible}`);
  }
});
