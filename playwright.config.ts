import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["browser.spec.ts", "production.spec.ts"],
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8765",
    viewport: { width: 1920, height: 1080 },
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: true,
  },
});
