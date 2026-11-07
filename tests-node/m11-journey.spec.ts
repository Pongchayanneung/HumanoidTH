import { test, expect, type Page } from "@playwright/test";

// Public destinations to test in Issue #11
const ALL_DESTINATIONS = [
  { id: "dashboard", path: "/dashboard" },
  { id: "robots", path: "/robots" },
  { id: "network", path: "/network" },
  { id: "map", path: "/map" },
  { id: "search", path: "/search" },
  { id: "contributions", path: "/contributions" },
  { id: "perspectives", path: "/perspectives" },
] as const;

// Desktop SidebarNav order of public destinations
const DESKTOP_NAV = ["/search", "/dashboard", "/map", "/network", "/perspectives", "/robots", "/contributions"];

// Mobile MobileTabNav order of public destinations
const MOBILE_NAV = ["/dashboard", "/search", "/robots", "/contributions"];

const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

async function assertFocusAndName(page: Page, desc: string) {
  const res = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const name = (el.getAttribute("aria-label") || el.innerText || "").trim();
    const style = window.getComputedStyle(el);
    const outline = style.outlineStyle;
    const shadow = style.boxShadow;
    const hasIndicator = (outline !== "none" && outline !== "") || (shadow !== "none" && shadow !== "");
    return { name, hasIndicator, outline, shadow };
  });

  expect(res, `An element must be focused for ${desc}`).not.toBeNull();
  expect(res!.name.length, `Focused element for ${desc} must have an accessible name`).toBeGreaterThan(0);
  expect(
    res!.hasIndicator,
    `Focused element for ${desc} must have a visible focus indicator (outline: ${res?.outline}, shadow: ${res?.shadow})`
  ).toBe(true);
}

async function tabUntil(
  page: Page,
  predicate: (info: { tag: string; path: string; label: string; text: string }) => boolean,
  desc: string,
  key: "Tab" | "Shift+Tab" = "Tab",
  cap = 40
): Promise<void> {
  for (let i = 0; i < cap; i++) {
    await page.keyboard.press(key);
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      return {
        tag: el.tagName,
        path: (el as HTMLAnchorElement).pathname || el.getAttribute("href") || "",
        label: el.getAttribute("aria-label") || "",
        text: el.innerText || "",
      };
    });
    if (info && predicate(info)) return;
  }
  throw new Error(`Failed to focus ${desc} within ${cap} ${key} presses`);
}

for (const vp of viewports) {
  const isMobile = vp.width < 860;
  const navPaths = isMobile ? MOBILE_NAV : DESKTOP_NAV;
  const navDests = navPaths
    .map((p) => ALL_DESTINATIONS.find((d) => d.path === p)!)
    .filter(Boolean);

  for (const lang of ["en", "th"] as const) {
    test(`walks main journey via keyboard @ ${vp.name} [${lang}]`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => sessionStorage.setItem("th_atlas_loaded_before", "true"));
      await page.goto("/");

      // On mobile, if nav is behind a menu button, open it with keyboard
      const menuBtn = page.getByRole("button", { name: /menu|navigation/i });
      if (await menuBtn.isVisible()) {
        await tabUntil(page, (el) => el.tag === "BUTTON" && /menu|navigation/i.test(el.label || el.text), "mobile menu button");
        await page.keyboard.press("Enter");
      }

      // Assert language switch can be operated by keyboard and h1 or nav text changes
      if (lang === "th") {
        await tabUntil(page, (el) => el.tag === "BUTTON" && el.label.includes("TH ภาษาไทย"), "TH language button");
        await assertFocusAndName(page, "TH language button");
        await page.keyboard.press("Space");
        await expect(page.locator("html")).toHaveAttribute("lang", "th", { timeout: 10000 });
        await expect(page.locator("h1:visible")).toContainText(/ภาพรวม/i, { timeout: 10000 });
      } else {
        await tabUntil(page, (el) => el.tag === "BUTTON" && el.label.includes("TH ภาษาไทย"), "TH language button");
        await assertFocusAndName(page, "TH language button");
        await page.keyboard.press("Space");
        await expect(page.locator("html")).toHaveAttribute("lang", "th", { timeout: 10000 });
        await tabUntil(page, (el) => el.tag === "BUTTON" && el.label.includes("EN English"), "EN language button", "Shift+Tab");
        await assertFocusAndName(page, "EN language button");
        await page.keyboard.press("Space");
        await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 10000 });
        await expect(page.locator("h1:visible")).toContainText(/overview/i, { timeout: 10000 });
      }

      // Reach each public destination that exists in the nav
      for (const dest of navDests) {
        if (isMobile && (await menuBtn.isVisible())) {
          await tabUntil(page, (el) => el.tag === "BUTTON" && /menu|navigation/i.test(el.label || el.text), "mobile menu button");
          await page.keyboard.press("Enter");
        }
        await tabUntil(page, (el) => el.tag === "A" && el.path === dest.path, `nav link for ${dest.id} (${dest.path})`);
        await assertFocusAndName(page, `nav link for ${dest.id}`);
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(`${dest.path}(\\?.*)?$`), { timeout: 10000 });
        await expect(page.locator("h1:visible")).toHaveCount(1, { timeout: 10000 });
      }
    });

    // Write test.skip for destinations not in this nav instead of inventing a route
    for (const dest of ALL_DESTINATIONS) {
      if (!navPaths.includes(dest.path)) {
        test(`destination ${dest.id} @ ${vp.name} [${lang}]`, () => {
          test.skip(true, `Destination "${dest.id}" (${dest.path}) is not present in ${vp.name} navigation`);
        });
      }
    }
  }
}
