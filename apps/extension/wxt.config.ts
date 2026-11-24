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
    // `activeTab` and `scripting` let the toolbar button start the content
    // script in a tab that was open before the extension was installed or
    // updated, so that the settings can open inside that page too.
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: [
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
    ],
    // No popup: pressing the toolbar button opens the settings in the page.
    action: { default_title: "Lingo settings" },
    // The page shown inside the in-page settings drawer. A web page can only
    // hold an extension page in an iframe when it is listed here.
    web_accessible_resources: [
      { resources: ["settings-drawer.html"], matches: ["<all_urls>"] },
    ],
    commands: {
      "lookup-selection": {
        suggested_key: { default: "Alt+Shift+L" },
        description: "Translate or define the selected text",
      },
    },
  },
});
