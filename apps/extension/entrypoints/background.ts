import type { ProviderId } from "@lingo/core";
import { createProvider } from "@lingo/providers";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { checkApiKey } from "../src/key-check.ts";
import { handleLookupPort } from "../src/lookup-handler.ts";
import {
  isRuntimeMessage,
  LOOKUP_COMMAND,
  LOOKUP_PORT,
  type RuntimeMessage,
} from "../src/messaging.ts";
import {
  loadApiKey,
  loadSettings,
  restrictStorageToTrustedContexts,
} from "../src/stores.ts";

/**
 * Set only in end-to-end test builds, where it points the adapters at a local
 * fake server. Production builds leave it undefined and call the real APIs.
 */
const E2E_BASE_URL: string | undefined = import.meta.env.WXT_E2E_LLM_BASE_URL;

function baseURL(provider: ProviderId): string | undefined {
  if (!E2E_BASE_URL) return undefined;
  // The OpenAI SDK expects the version segment in its base URL.
  return provider === "openai" ? `${E2E_BASE_URL}/v1` : E2E_BASE_URL;
}

export default defineBackground(() => {
  void restrictStorageToTrustedContexts();

  // API keys are used and provider calls are made here only, never in a
  // content script.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== LOOKUP_PORT) return;
    handleLookupPort(port, {
      loadSettings,
      loadApiKey,
      createProvider,
      baseURL,
    });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRuntimeMessage(message)) return;
    switch (message.type) {
      case "open-settings":
        void browser.runtime.openOptionsPage();
        return;
      case "check-api-key":
        // Only the extension's own pages have a key to check. A content
        // script runs inside a web page, so it is not answered.
        if (!sender.url?.startsWith(browser.runtime.getURL("/"))) return;
        void checkApiKey(message.provider, message.apiKey, {
          createProvider,
          baseURL,
        }).then(sendResponse);
        // Keeps the channel open until the provider has answered.
        return true;
    }
  });

  // The shortcut is handled here, and the selection lives in the page, so
  // ask the tab's content scripts to look it up.
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== LOOKUP_COMMAND || tab?.id === undefined) return;
    const message: RuntimeMessage = { type: "lookup-selection" };
    browser.tabs.sendMessage(tab.id, message).catch(() => {
      // No content script runs on this page, such as a browser settings page.
    });
  });

  // A new install has no API key yet, so start on the settings page.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") void browser.runtime.openOptionsPage();
  });
});
