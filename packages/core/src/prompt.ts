import prompts from "@lingo/spec/prompts.json" with { type: "json" };
import { type CapturedContext, hasSurroundingText } from "./context.ts";
import type { ChatRequest } from "./llm.ts";

/** What to do with a selection: translate it, or explain it like a dictionary. */
export type LookupMode = "translate" | "define";

export interface LookupInput {
  mode: LookupMode;
  context: CapturedContext;
  /** English name of the language to answer in, such as "Korean". */
  targetLanguage: string;
}

export type PromptVariant = "withContext" | "withoutContext";

/** The context variant of the system prompt that fits what was captured. */
export function promptVariant(context: CapturedContext): PromptVariant {
  return hasSurroundingText(context) ? "withContext" : "withoutContext";
}

/** Fills a system prompt template from `spec/prompts.json`. */
export function renderSystemPrompt(
  mode: LookupMode,
  variant: PromptVariant,
  targetLanguage: string,
): string {
  return prompts.system[mode][variant]
    .join("\n")
    .replaceAll("{{targetLanguage}}", targetLanguage);
}

/**
 * Builds the model request for a lookup. The assembly rules are pinned by the
 * golden cases in `spec/prompt-cases.json`, which other implementations of
 * the core must pass too.
 */
export function buildLookupRequest(input: LookupInput): ChatRequest {
  const { mode, context, targetLanguage } = input;
  const variant = promptVariant(context);
  return {
    system: renderSystemPrompt(mode, variant, targetLanguage),
    messages: [{ role: "user", content: renderUserMessage(context, variant) }],
  };
}

function renderUserMessage(
  context: CapturedContext,
  variant: PromptVariant,
): string {
  const selection = `<selection>${context.selection}</selection>`;
  if (variant === "withoutContext") return selection;

  const lines = ["<context>"];
  if (context.title) lines.push(`<title>${context.title}</title>`);
  const passage = `${context.before ?? ""}[[${context.selection}]]${context.after ?? ""}`;
  lines.push(`<passage>${passage}</passage>`, "</context>", selection);
  return lines.join("\n");
}
