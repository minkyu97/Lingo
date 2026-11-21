import cases from "@lingo/spec/prompt-cases.json" with { type: "json" };
import prompts from "@lingo/spec/prompts.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import type { CapturedContext } from "./context.ts";
import {
  buildLookupRequest,
  type LookupMode,
  type PromptVariant,
  renderSystemPrompt,
} from "./prompt.ts";

describe("buildLookupRequest", () => {
  it.each(cases)("$name", ({ input, expected }) => {
    const request = buildLookupRequest({
      mode: input.mode as LookupMode,
      context: input.context as CapturedContext,
      targetLanguage: input.targetLanguage,
    });

    const [mode, variant] = expected.systemTemplate.split(".") as [
      LookupMode,
      PromptVariant,
    ];
    expect(request.system).toBe(
      renderSystemPrompt(mode, variant, input.targetLanguage),
    );
    expect(request.messages).toEqual([
      { role: "user", content: expected.user },
    ]);
  });
});

describe("renderSystemPrompt", () => {
  const modes: LookupMode[] = ["translate", "define"];
  const variants: PromptVariant[] = ["withContext", "withoutContext"];

  it("fills in the target language and leaves no placeholder", () => {
    for (const mode of modes) {
      for (const variant of variants) {
        const system = renderSystemPrompt(mode, variant, "Korean");
        expect(system).toContain("Korean");
        expect(system).not.toContain("{{");
      }
    }
  });

  it("mentions the context block only when there is one", () => {
    for (const mode of modes) {
      expect(renderSystemPrompt(mode, "withContext", "Korean")).toContain(
        "<context>",
      );
      expect(
        renderSystemPrompt(mode, "withoutContext", "Korean"),
      ).not.toContain("<context>");
    }
  });

  it("has a template for every mode and variant", () => {
    expect(Object.keys(prompts.system).sort()).toEqual([...modes].sort());
    for (const mode of modes) {
      expect(Object.keys(prompts.system[mode]).sort()).toEqual(
        [...variants].sort(),
      );
    }
  });
});
