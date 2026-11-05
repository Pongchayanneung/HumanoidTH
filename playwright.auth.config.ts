import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { browserOrigin, scratchBaseUrl } from "./test-integration/fixture";

scratchBaseUrl();
process.env.ISSUE4_BROWSER_DATABASE_NAME ??= `hri_issue4_acceptance_browser_${Date.now()}_${randomBytes(3).toString("hex")}`;

export default defineConfig({
  testDir: "./tests-node",
  testMatch: ["operator-auth.spec.ts", "smoke.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: {
    baseURL: browserOrigin, trace: "off", screenshot: "only-on-failure", navigationTimeout: 45_000,
    ...(process.env.ISSUE4_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.ISSUE4_BROWSER_EXECUTABLE } } : {})
  },
  projects: [{ name: "auth-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import tsx scripts/auth-test-server.ts",
    env: {
      ISSUE4_AUTH_ACCEPTANCE: "1",
      ISSUE4_BROWSER_DATABASE_NAME: process.env.ISSUE4_BROWSER_DATABASE_NAME,
      ...(process.env.ISSUE4_TEST_DATABASE_URL ? { ISSUE4_TEST_DATABASE_URL: process.env.ISSUE4_TEST_DATABASE_URL } : {})
    },
    url: `${browserOrigin}/admin-login`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
