import { defaultSettings, type Settings } from "@lingo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  loadEngineKey,
  loadEngineKeys,
  loadSettings,
  saveEngineKey,
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
      engines: [{ id: "a", provider: "openai", model: "gpt-6-luna" }],
      engineFor: { page: "a" },
      targetLanguage: "ja",
      contextAwareness: false,
      maxContextChars: 400,
      pageRequestsPerSecond: 5,
    };
    await saveSettings(settings);
    expect(await loadSettings()).toEqual(settings);
  });

  it("repairs stored data that is no longer valid", async () => {
    await fakeBrowser.storage.local.set({
      settings: { engines: "gone", targetLanguage: "ko" },
    });
    const settings = await loadSettings();
    expect(settings.engines).toEqual([]);
    expect(settings.targetLanguage).toBe("ko");
  });
});

describe("settings from before there were engines", () => {
  beforeEach(async () => {
    await fakeBrowser.storage.local.set({
      settings: {
        provider: "anthropic",
        models: { anthropic: "claude-sonnet-5-5" },
        pageModels: {},
        targetLanguage: "ja",
        contextAwareness: false,
        maxContextChars: 500,
        pageRequestsPerSecond: 5,
      },
      apiKeys: { anthropic: "key-a" },
    });
  });

  it("become engines, with everything else kept", async () => {
    const settings = await loadSettings();
    expect(settings).toMatchObject({
      engines: [
        { id: "migrated-1", model: "claude-sonnet-5-5" },
        { id: "migrated-2", model: "claude-haiku-5-5" },
      ],
      engineFor: {
        translate: "migrated-1",
        define: "migrated-1",
        page: "migrated-2",
      },
      targetLanguage: "ja",
      contextAwareness: false,
      maxContextChars: 500,
      pageRequestsPerSecond: 5,
    });
    expect(await loadEngineKeys()).toEqual({
      "migrated-1": "key-a",
      "migrated-2": "key-a",
    });
  });

  it("are converted once, and the old keys are gone after that", async () => {
    const first = await loadSettings();
    expect(await fakeBrowser.storage.local.get("apiKeys")).toEqual({});
    const stored = await fakeBrowser.storage.local.get("settings");
    expect(stored.settings).toEqual(first);

    // What the user does afterwards is not converted over again.
    await saveSettings({ ...first, engines: [], engineFor: {} });
    expect((await loadSettings()).engines).toEqual([]);
  });
});

describe("API keys", () => {
  it("has no keys at first", async () => {
    expect(await loadEngineKeys()).toEqual({});
    expect(await loadEngineKey("a")).toBeUndefined();
  });

  it("stores a trimmed key per engine", async () => {
    await saveEngineKey("a", "  key-a  ");
    await saveEngineKey("b", "key-b");
    expect(await loadEngineKeys()).toEqual({ a: "key-a", b: "key-b" });
    expect(await loadEngineKey("b")).toBe("key-b");
  });

  it("removes a key that is saved empty or not at all", async () => {
    await saveEngineKey("a", "key-a");
    await saveEngineKey("b", "key-b");
    await saveEngineKey("a", "   ");
    await saveEngineKey("b", undefined);
    expect(await loadEngineKeys()).toEqual({});
  });

  it("keeps keys in local storage, not synced storage", async () => {
    await saveEngineKey("a", "key-a");
    expect(await fakeBrowser.storage.local.get("engineKeys")).toEqual({
      engineKeys: { a: "key-a" },
    });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });

  it("reads damaged data as no keys", async () => {
    await fakeBrowser.storage.local.set({ engineKeys: "nope" });
    expect(await loadEngineKeys()).toEqual({});
    await fakeBrowser.storage.local.set({ engineKeys: { a: 5, b: "ok" } });
    expect(await loadEngineKeys()).toEqual({ b: "ok" });
  });
});
