import { describe, expect, it } from "vitest";
import {
  CONTEXT_CHAR_PRESETS,
  defaultSettings,
  languageName,
  MAX_CONTEXT_CHARS_LIMIT,
  nativeLanguageName,
  normalizeSettings,
  PAGE_REQUEST_RATE_PRESETS,
  perProviderTextSchema,
  TARGET_LANGUAGES,
} from "./settings.ts";

describe("defaultSettings", () => {
  it("translates into the language of the locale", () => {
    expect(defaultSettings("ko-KR").targetLanguage).toBe("ko");
    expect(defaultSettings("en-US").targetLanguage).toBe("en");
  });

  it("keeps the script for Chinese", () => {
    expect(defaultSettings("zh-TW").targetLanguage).toBe("zh-Hant");
    expect(defaultSettings("zh-CN").targetLanguage).toBe("zh-Hans");
  });

  it("falls back to English without a usable locale", () => {
    expect(defaultSettings().targetLanguage).toBe("en");
    expect(defaultSettings("not a locale").targetLanguage).toBe("en");
  });
});

describe("normalizeSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const value of [undefined, null, "x", 3, []]) {
      expect(normalizeSettings(value, "ko")).toEqual(defaultSettings("ko"));
    }
  });

  it("keeps valid stored values", () => {
    const stored = {
      engines: [
        { id: "a", provider: "openai", model: "gpt-6.2-sol" },
        {
          id: "b",
          provider: "anthropic",
          model: "claude-fable-5-2",
          modelLabel: "Claude Fable 5.2",
          name: "Dictionary",
          capabilities: { effort: true, structuredOutput: true },
          parameters: { temperature: 0.3 },
        },
      ],
      engineFor: { translate: "a", define: "b" },
      targetLanguage: "ja",
      contextAwareness: false,
      maxContextChars: 500,
      pageRequestsPerSecond: 5,
    };
    expect(normalizeSettings(stored, "ko")).toEqual(stored);
  });

  it("leaves out an engine that is unusable, and keeps the rest", () => {
    const good = { id: "a", provider: "openai", model: "gpt-6.2-sol" };
    const { engines } = normalizeSettings({
      engines: [
        { id: "x", provider: "nope", model: "m" },
        { id: "y", provider: "openai", model: "  " },
        { provider: "openai", model: "m" },
        "not an engine",
        good,
        // The same ID again.
        { ...good, model: "other" },
      ],
    });
    expect(engines).toEqual([good]);
  });

  it("trims model IDs, and drops what is wrong inside an engine", () => {
    const { engines } = normalizeSettings({
      engines: [
        {
          id: "a",
          provider: "anthropic",
          model: " m ",
          name: "  ",
          capabilities: "all",
          parameters: [1, 2],
        },
      ],
    });
    expect(engines).toEqual([{ id: "a", provider: "anthropic", model: "m" }]);
  });

  it("forgets the choice of an engine that is gone", () => {
    const settings = normalizeSettings({
      engines: [{ id: "a", provider: "openai", model: "m" }],
      engineFor: { translate: "a", define: "gone", page: 5 },
    });
    expect(settings.engineFor).toEqual({ translate: "a" });
  });

  it("keeps the request rate for pages within what a provider can take", () => {
    const rate = (value: unknown) =>
      normalizeSettings({ pageRequestsPerSecond: value }, "ko")
        .pageRequestsPerSecond;
    expect(rate(1)).toBe(1);
    expect(rate(0)).toBe(1);
    expect(rate(2.4)).toBe(2);
    expect(rate(500)).toBe(10);
    expect(rate("fast")).toBe(3);
    // Every rate offered in settings is one that is kept as it is.
    for (const preset of PAGE_REQUEST_RATE_PRESETS) {
      expect(rate(preset)).toBe(preset);
    }
  });

  it("replaces invalid fields one by one", () => {
    const settings = normalizeSettings(
      {
        engines: "many",
        engineFor: "all",
        targetLanguage: "not a tag",
        contextAwareness: "yes",
        maxContextChars: "many",
        pageRequestsPerSecond: null,
      },
      "ko",
    );
    expect(settings).toEqual(defaultSettings("ko"));
  });

  it("keeps the context length within its limits", () => {
    expect(normalizeSettings({ maxContextChars: -5 }).maxContextChars).toBe(0);
    expect(normalizeSettings({ maxContextChars: 1e9 }).maxContextChars).toBe(
      MAX_CONTEXT_CHARS_LIMIT,
    );
    expect(normalizeSettings({ maxContextChars: 12.6 }).maxContextChars).toBe(
      13,
    );
  });
});

describe("languageName", () => {
  it("gives the English name of a tag", () => {
    expect(languageName("ko")).toBe("Korean");
    expect(languageName("ja")).toBe("Japanese");
  });

  it("names every offered target language", () => {
    for (const tag of TARGET_LANGUAGES) {
      expect(languageName(tag)).not.toBe(tag);
    }
  });

  it("returns the input when it cannot be named", () => {
    expect(languageName("not a tag")).toBe("not a tag");
  });
});

describe("nativeLanguageName", () => {
  it("gives the name a language has for itself", () => {
    expect(nativeLanguageName("ko")).toBe("한국어");
    expect(nativeLanguageName("zh-Hant")).toBe("繁體中文");
  });

  it("capitalizes names that are written in lower case", () => {
    expect(nativeLanguageName("es")).toBe("Español");
    expect(nativeLanguageName("uk")).toBe("Українська");
  });

  it("names every offered target language", () => {
    for (const tag of TARGET_LANGUAGES) {
      expect(nativeLanguageName(tag)).not.toBe(tag);
    }
  });

  it("returns the input when it cannot be named", () => {
    expect(nativeLanguageName("not a tag")).toBe("not a tag");
  });
});

describe("CONTEXT_CHAR_PRESETS", () => {
  it("offers the default, and nothing above the limit", () => {
    expect(CONTEXT_CHAR_PRESETS).toContain(defaultSettings().maxContextChars);
    expect(Math.max(...CONTEXT_CHAR_PRESETS)).toBe(MAX_CONTEXT_CHARS_LIMIT);
  });
});

describe("perProviderTextSchema", () => {
  it("keeps trimmed text per provider and leaves out everything else", () => {
    const parsed = perProviderTextSchema.parse({
      anthropic: "  key-a  ",
      openai: "   ",
      other: "x",
    });
    expect(parsed).toEqual({ anthropic: "key-a" });
    expect(Object.keys(parsed)).toEqual(["anthropic"]);
    expect(Object.keys(perProviderTextSchema.parse({ openai: 5 }))).toEqual([]);
  });

  it("does not accept a value that is not an object", () => {
    for (const value of [undefined, null, "x", 3, []]) {
      expect(perProviderTextSchema.safeParse(value).success).toBe(false);
    }
  });
});
