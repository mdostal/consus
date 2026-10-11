import { defineConfig, devices } from "@playwright/test";

// PANT-965: browser checks against the built app. `npm run test:e2e` builds
// first; e2e/server.mjs starts the server with a fixture repo.
const PORT = Number(process.env.E2E_PORT ?? 18965);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  // Firefox too (PANT-960): in some containers headless Chromium's renderer
  // crashes on the main app view, on unmodified dev as well, so
  // `--project=firefox` is the fallback there.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
    timeout: 60_000,
  },
});
