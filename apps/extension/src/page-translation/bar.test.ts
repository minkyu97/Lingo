import { describe, expect, it } from "vitest";
import { describeBar } from "./bar.ts";
import { pageTranslationOptionsSchema } from "./protocol.ts";
import type { PageProblem } from "./translator.ts";

const config = {
  options: pageTranslationOptionsSchema.parse({}),
  targetLanguage: "ko",
  provider: "Anthropic",
};

describe("describeBar", () => {
  it("shows nothing while translation is off or has not started", () => {
    expect(describeBar({ active: false })).toBeUndefined();
    expect(describeBar({ active: true })).toBeUndefined();
  });

  it("names the language, in that language, and offers the original", () => {
    expect(describeBar({ active: true, config })).toEqual({
      state: "translating",
      label: "Translating into 한국어",
      action: "stop",
      actionLabel: "Show original",
    });
  });

  it.each<[PageProblem, string, string, string]>([
    [
      "missing_key",
      "Add an API key to translate pages",
      "settings",
      "Open settings",
    ],
    [
      "auth",
      "Anthropic did not accept the API key",
      "settings",
      "Open settings",
    ],
    ["network", "Could not reach Anthropic", "retry", "Try again"],
    ["rate_limit", "Anthropic asked Lingo to slow down", "retry", "Try again"],
    ["api", "Anthropic could not translate this page", "retry", "Try again"],
    ["interrupted", "Lingo lost its connection", "retry", "Try again"],
    ["updated", "Lingo was updated", "reload", "Reload page"],
  ])(
    "says what a %s problem is, and the way out of it",
    (problem, label, action, actionLabel) => {
      expect(describeBar({ active: true, config, problem })).toEqual({
        state: "problem",
        label,
        action,
        actionLabel,
      });
    },
  );

  it("can name a problem before it knows the provider", () => {
    expect(describeBar({ active: true, problem: "updated" })?.label).toBe(
      "Lingo was updated",
    );
    expect(describeBar({ active: true, problem: "network" })?.label).toBe(
      "Could not reach The provider",
    );
  });
});
