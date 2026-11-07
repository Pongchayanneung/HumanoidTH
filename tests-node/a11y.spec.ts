import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Public pages only. Fails on serious or critical WCAG 2.x A/AA violations that axe can detect
// automatically. Automated checks find a minority of accessibility problems: keyboard use and
// screen-reader use still need a manual pass.
const routes = ["/", "/dashboard", "/robots", "/network", "/map", "/perspectives", "/contributions"];
const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

for (const viewport of viewports) {
  for (const route of routes) {
    test(`axe ${route} @ ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const summary = blocking.map((v) => `${v.impact} ${v.id} (${v.nodes.length} nodes): ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }
}
