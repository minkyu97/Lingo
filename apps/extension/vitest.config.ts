import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    // End-to-end specs under e2e/ are run by Playwright, not Vitest.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
