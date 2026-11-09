import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --import tsx tests/e2e-server.ts",
      url: "http://127.0.0.1:3101/api/health",
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: "npm --workspace apps/web run dev -- --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      env: { API_PROXY_TARGET: "http://127.0.0.1:3101" },
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
