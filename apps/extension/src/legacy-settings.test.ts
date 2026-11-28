import { describe, expect, it } from "vitest";
import { migrateLegacySettings } from "./legacy-settings.ts";

describe("migrateLegacySettings", () => {
  it("leaves settings of the new shape alone", () => {
    expect(migrateLegacySettings({ engines: [] }, {})).toBeUndefined();
    expect(migrateLegacySettings(undefined, undefined)).toBeUndefined();
  });

  it("makes engines of the selected provider's models and key", () => {
    const migrated = migrateLegacySettings(
      {
        provider: "anthropic",
        models: { anthropic: "claude-sonnet-5-5" },
        pageModels: {},
        targetLanguage: "ko",
      },
      { anthropic: "key-a" },
    );
    expect(migrated).toEqual({
      engines: [
        {
          id: "migrated-1",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          modelLabel: "Claude Sonnet 5.5",
        },
        {
          id: "migrated-2",
          provider: "anthropic",
          model: "claude-haiku-5-5",
          modelLabel: "Claude Haiku 5.5",
        },
      ],
      engineFor: {
        translate: "migrated-1",
        define: "migrated-1",
        page: "migrated-2",
      },
      keys: { "migrated-1": "key-a", "migrated-2": "key-a" },
    });
  });

  it("uses the models that were the defaults when none was chosen", () => {
    const migrated = migrateLegacySettings(
      { provider: "anthropic" },
      { anthropic: "key-a" },
    );
    expect(migrated?.engines.map((engine) => engine.model)).toEqual([
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("makes one engine where lookups and pages had the same model", () => {
    const migrated = migrateLegacySettings(
      { provider: "openai" },
      { openai: "key-o" },
    );
    expect(migrated?.engines).toHaveLength(1);
    expect(migrated?.engineFor).toEqual({
      translate: "migrated-1",
      define: "migrated-1",
      page: "migrated-1",
    });
  });

  it("keeps the key of the other provider as an engine of its own", () => {
    const migrated = migrateLegacySettings(
      { provider: "openai", models: { anthropic: "claude-next" } },
      { openai: "key-o", anthropic: "key-a" },
    );
    expect(migrated?.engines).toEqual([
      {
        id: "migrated-1",
        provider: "openai",
        model: "gpt-6.2-sol",
        modelLabel: "GPT-6.2 Sol",
      },
      // A model that was typed in by hand has no name to show.
      { id: "migrated-2", provider: "anthropic", model: "claude-next" },
    ]);
    expect(migrated?.engineFor.page).toBe("migrated-1");
    expect(migrated?.keys).toEqual({
      "migrated-1": "key-o",
      "migrated-2": "key-a",
    });
  });

  it("makes no engine without a key", () => {
    expect(migrateLegacySettings({ provider: "anthropic" }, {})).toEqual({
      engines: [],
      engineFor: {},
      keys: {},
    });
  });
});
