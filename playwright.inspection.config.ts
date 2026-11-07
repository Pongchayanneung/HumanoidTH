import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { inspectionOrigin } from "./test-integration/admin-inspection-fixture";
import { scratchBaseUrl } from "./test-integration/fixture";

scratchBaseUrl();
process.env.ISSUE8_BROWSER_DATABASE_NAME ??= `hri_issue4_acceptance_inspect_${Date.now()}_${randomBytes(3).toString("hex")}`;

export default defineConfig({
  testDir: "./tests-node",
  testMatch: "admin-inspection.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: {
    baseURL: inspectionOrigin,
    trace: "off",
    navigationTimeout: 45_000,
    ...(process.env.ISSUE4_BROWSER_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.ISSUE4_BROWSER_EXECUTABLE } }
      : {})
  },
  projects: [{ name: "inspection-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import tsx scripts/inspection-test-server.ts",
    env: {
      ISSUE4_AUTH_ACCEPTANCE: "1",
      ISSUE8_BROWSER_DATABASE_NAME: process.env.ISSUE8_BROWSER_DATABASE_NAME
    },
    url: `${inspectionOrigin}/admin-login`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
