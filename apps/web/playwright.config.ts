// Playwright for the browser tests (docs/TESTING.md): the core three screens, against a production build of the app made
// with the Konva Test settings only (e2e/support/serve.ts), in its own folder (.next-e2e) on port 3100, started and
// stopped here for each run. The settings are checked as this file loads, so a run pointed anywhere else never starts.
// Not part of `pnpm test` or CI yet (Phase 5).

import { defineConfig, devices } from "@playwright/test";
import { APP_ORIGIN, loadTestEnv } from "./e2e/support/test-env";
import { ZONE } from "./e2e/support/time";

loadTestEnv();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/support/global-setup.ts",
  timeout: 60_000, // ms per test
  expect: { timeout: 10_000 }, // ms
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One worker per project: the three run side by side, each project's tests in order.
  workers: 3,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_ORIGIN,
    // The made-up data is dated in this zone (e2e/support/time.ts), so "today" is the same day in the database and on screen.
    timezoneId: ZONE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "Desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // WebKit's context routing does not see service worker requests, so service workers are blocked there.
    { name: "iPhone", use: { ...devices["iPhone 15"], serviceWorkers: "block" } },
    { name: "Android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm exec tsx e2e/support/serve.ts",
    url: `${APP_ORIGIN}/login`,
    // Never reuse whatever else might be on the port: it is this run's own server or nothing.
    reuseExistingServer: false,
    timeout: 600_000, // ms: the build comes first
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
