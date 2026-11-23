import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Explicit imports only. Auto-imports would also rewrite the workspace
  // packages this app consumes as source.
  imports: false,
  manifest: {
    name: "Lingo",
    description: "Translate or define selected text with your own LLM API key.",
    // storage.local can be closed to content scripts from Chrome 140 on.
    minimum_chrome_version: "140",
    permissions: ["storage"],
    host_permissions: [
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
    ],
    commands: {
      "lookup-selection": {
        suggested_key: { default: "Alt+Shift+L" },
        description: "Translate or define the selected text",
      },
    },
  },
});
