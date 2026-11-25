import { defaultSettings, type Settings } from "@lingo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  loadApiKey,
  loadApiKeys,
  loadSettings,
  saveApiKeys,
  saveSettings,
} from "./stores.ts";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("settings", () => {
  it("starts from the defaults for the browser's language", async () => {
    expect(await loadSettings()).toEqual(defaultSettings(navigator.language));
  });

  it("returns what was saved", async () => {
    const settings: Settings = {
      provider: "openai",
      models: { openai: "gpt-6-luna" },
      targetLanguage: "ja",
      contextAwareness: false,
      maxContextChars: 400,
      pageModels: { openai: "gpt-6-luna" },
      pageRequestsPerSecond: 5,
    };
    await saveSettings(settings);
    expect(await loadSettings()).toEqual(settings);
  });

  it("repairs stored data that is no longer valid", async () => {
    await fakeBrowser.storage.local.set({
      settings: { provider: "gone", targetLanguage: "ko" },
    });
    const settings = await loadSettings();
    expect(settings.provider).toBe("anthropic");
    expect(settings.targetLanguage).toBe("ko");
  });
});

describe("API keys", () => {
  it("has no keys at first", async () => {
    expect(await loadApiKeys()).toEqual({});
    expect(await loadApiKey("anthropic")).toBeUndefined();
  });

  it("stores trimmed keys per provider", async () => {
    await saveApiKeys({ anthropic: "  key-a  ", openai: "key-o" });
    expect(await loadApiKeys()).toEqual({
      anthropic: "key-a",
      openai: "key-o",
    });
    expect(await loadApiKey("openai")).toBe("key-o");
  });

  it("removes a key that is saved empty", async () => {
    await saveApiKeys({ anthropic: "key-a", openai: "key-o" });
    await saveApiKeys({ anthropic: "key-a", openai: "   " });
    expect(await loadApiKeys()).toEqual({ anthropic: "key-a" });
  });

  it("keeps keys in local storage, not synced storage", async () => {
    await saveApiKeys({ anthropic: "key-a" });
    expect(await fakeBrowser.storage.local.get("apiKeys")).toEqual({
      apiKeys: { anthropic: "key-a" },
    });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });
});
