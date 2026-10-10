import { defineConfig, devices } from "@playwright/test";

/** PANT-960: browser checks against a throwaway server (e2e/serve.mjs) that
 *  serves the built web app. Run with `npm run test:e2e`. */
const port = process.env.CONSUS_E2E_PORT ?? "18960";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  // Firefox too: in some containers headless Chromium's renderer crashes on
  // the main app view (also on unmodified dev), so `--project=firefox` is
  // the fallback there.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run build:web && node e2e/serve.mjs",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
