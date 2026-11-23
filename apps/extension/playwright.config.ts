import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // The specs share one fake server that records requests, so run them in order.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  webServer: {
    command: "node e2e/fake-llm-server.ts",
    url: "http://127.0.0.1:43117/page",
    reuseExistingServer: !process.env.CI,
  },
});
