import type { ProviderId } from "@lingo/core";
import { createProvider } from "@lingo/providers";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { answerCacheRequest } from "../src/cache-usage.ts";
import { checkApiKey } from "../src/key-check.ts";
import { handleLookupPort } from "../src/lookup-handler.ts";
import {
  isRuntimeMessage,
  LOOKUP_COMMAND,
  LOOKUP_PORT,
  type RuntimeMessage,
} from "../src/messaging.ts";
import { handlePageTranslationPort } from "../src/page-translation/handler.ts";
import {
  PAGE_TRANSLATION_COMMAND,
  PAGE_TRANSLATION_PORT,
} from "../src/page-translation/protocol.ts";
import { createRateLimiter } from "../src/page-translation/rate-limiter.ts";
import { createPageSwitch } from "../src/page-translation/switch.ts";
import { createResponseCache } from "../src/response-cache.ts";
import { createSettingsDrawer } from "../src/settings-drawer.ts";
import {
  loadEngineKey,
  loadPageTranslationOptions,
  loadSettings,
  restrictStorageToTrustedContexts,
} from "../src/stores.ts";

/**
 * Set only in end-to-end test builds, where it points the adapters at a local
 * fake server. Production builds leave it undefined and call the real APIs.
 */
const E2E_BASE_URL: string | undefined = import.meta.env.WXT_E2E_LLM_BASE_URL;

/** How much of the storage is kept free of cached answers, in bytes. */
const CACHE_RESERVE_BYTES = 1024 * 1024;

/** Where the build puts the script of `entrypoints/content`. */
const CONTENT_SCRIPT = "/content-scripts/content.js";

function baseURL(provider: ProviderId): string | undefined {
  if (!E2E_BASE_URL) return undefined;
  // The OpenAI SDK expects the version segment in its base URL.
  return provider === "openai" ? `${E2E_BASE_URL}/v1` : E2E_BASE_URL;
}

export default defineBackground(() => {
  void restrictStorageToTrustedContexts();

  // Answers are kept in the same storage as the settings, which is closed
  // to content scripts. Some of its room is left for everything else.
  const maxCacheBytes = browser.storage.local.QUOTA_BYTES - CACHE_RESERVE_BYTES;
  const cache = createResponseCache({
    area: browser.storage.local,
    maxBytes: maxCacheBytes,
  });

  // API keys are used and provider calls are made here only, never in a
  // content script.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== LOOKUP_PORT) return;
    handleLookupPort(port, {
      loadSettings,
      loadEngineKey,
      createProvider,
      baseURL,
      cache,
    });
  });

  // One limiter for every tab and frame, since they share one API key.
  const limiter = createRateLimiter();
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PAGE_TRANSLATION_PORT) return;
    handlePageTranslationPort(port, {
      loadSettings,
      loadOptions: loadPageTranslationOptions,
      loadEngineKey,
      createProvider,
      limiter,
      baseURL,
      cache,
    });
  });

  const drawer = createSettingsDrawer({
    sendToTopFrame: (tabId, message) =>
      browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    isLoading: async (tabId) =>
      (await browser.tabs.get(tabId)).status === "loading",
    // Allowed by `activeTab`, in the tab whose toolbar button was pressed.
    startContentScript: (tabId) =>
      browser.scripting.executeScript({
        target: { tabId },
        files: [CONTENT_SCRIPT],
      }),
    openOptionsPage: () => browser.runtime.openOptionsPage(),
  });

  const pageSwitch = createPageSwitch({
    sendToTopFrame: (tabId, message) =>
      browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    sendToAllFrames: (tabId, message) =>
      browser.tabs.sendMessage(tabId, message),
    tellOwnPages: (message) => browser.runtime.sendMessage(message),
  });

  // The toolbar button opens the settings inside the current page. There is
  // no popup, which is what makes this event fire.
  browser.action.onClicked.addListener((tab) => {
    void drawer.request(tab.id, "toggle");
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRuntimeMessage(message)) return;
    // The extension's own pages, as opposed to a content script, which runs
    // inside a web page.
    const fromOwnPage =
      sender.url?.startsWith(browser.runtime.getURL("/")) ?? false;

    switch (message.type) {
      case "settings-drawer":
        void drawer.request(sender.tab?.id, message.action);
        return;
      case "settings-drawer-grant":
        sendResponse(fromOwnPage && drawer.claimGrant(sender.tab?.id));
        return;
      case "page-translation":
        void pageSwitch
          .request(sender.tab?.id, message.action)
          .then(sendResponse);
        // Keeps the channel open until the top frame has answered.
        return true;
      case "check-api-key":
        // Only the extension's own pages have a key to check.
        if (!fromOwnPage) return;
        void checkApiKey(message.provider, message.apiKey, {
          createProvider,
          baseURL,
        }).then(sendResponse);
        // Keeps the channel open until the provider has answered.
        return true;
      case "response-cache":
        // Stored answers hold what the user read. Web pages do not get them.
        if (!fromOwnPage) return;
        void answerCacheRequest(message.action, cache, maxCacheBytes).then(
          sendResponse,
        );
        // Keeps the channel open until the cache has been read.
        return true;
    }
  });

  // The shortcut is handled here, and the selection lives in the page, so
  // ask the tab's content scripts to look it up.
  browser.commands.onCommand.addListener((command, tab) => {
    if (tab?.id === undefined) return;
    if (command === PAGE_TRANSLATION_COMMAND) {
      void pageSwitch.request(tab.id, "toggle");
      return;
    }
    if (command !== LOOKUP_COMMAND) return;
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
