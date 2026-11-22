import cases from "@lingo/spec/prompt-cases.json" with { type: "json" };
import prompts from "@lingo/spec/prompts.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import type { CapturedContext } from "./context.ts";
import {
  buildLookupRequest,
  DICTIONARY_ENTRY_FORMAT,
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

describe("the answer format", () => {
  const context: CapturedContext = { selection: "bank", level: "none" };

  it("asks for a dictionary entry as JSON when defining", () => {
    const request = buildLookupRequest({
      mode: "define",
      context,
      targetLanguage: "Korean",
    });
    expect(request.format).toBe(DICTIONARY_ENTRY_FORMAT);
    expect(request.format?.name).toBe("dictionary_entry");
  });

  it("asks for plain text when translating", () => {
    const request = buildLookupRequest({
      mode: "translate",
      context,
      targetLanguage: "Korean",
    });
    expect(request.format).toBeUndefined();
  });

  it("describes in the prompt every field the schema requires", () => {
    const schema = DICTIONARY_ENTRY_FORMAT.schema as {
      required: string[];
      properties: { senses: { items: { required: string[] } } };
    };
    const fields = [
      ...schema.required,
      ...schema.properties.senses.items.required,
    ];
    for (const variant of ["withContext", "withoutContext"] as const) {
      const system = renderSystemPrompt("define", variant, "Korean");
      for (const field of fields) {
        expect(system, `${variant} mentions ${field}`).toContain(`"${field}"`);
      }
    }
  });

  it("uses a schema that strict structured outputs accept", () => {
    const check = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(
          Object.keys(schema.properties as object).sort(),
        );
      }
      for (const child of Object.values(schema)) check(child);
    };
    check(DICTIONARY_ENTRY_FORMAT.schema);
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
