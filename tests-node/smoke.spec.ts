import { test, expect } from "@playwright/test";

test("public pages remain usable without an operator or simulator login", async ({ page }) => {
  for (const route of ["/", "/dashboard", "/perspectives", "/robots", "/inventory", "/contributions", "/analytics", "/database"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);

    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });
    const text = await h1.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  }
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin-login$/);
  await expect(page.getByRole("heading", { name: "Operator sign-in", exact: true })).toBeVisible();
});
