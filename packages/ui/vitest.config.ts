import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Hand over the text of a style sheet that a test imports. By default a
    // test gets an empty one. A test reads `tokens.css` to compare values.
    css: true,
  },
});
