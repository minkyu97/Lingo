import {
  type CapturedContext,
  clampContext,
  withoutContext,
} from "./context.ts";
import type { ChatRequest } from "./llm.ts";
import { buildLookupRequest, type LookupMode } from "./prompt.ts";
import { languageName, type Settings } from "./settings.ts";

export type LookupSettings = Pick<
  Settings,
  "targetLanguage" | "contextAwareness" | "maxContextChars"
>;

export interface PreparedLookup {
  /** The request to send to an `LLMProvider`. */
  request: ChatRequest;
  /** The context that is actually sent, after the settings were applied. */
  context: CapturedContext;
}

/**
 * Use case: turn a captured selection into a model request. The user's
 * settings decide how much of the captured context leaves the device.
 */
export function prepareLookup(
  mode: LookupMode,
  captured: CapturedContext,
  settings: LookupSettings,
): PreparedLookup {
  const context = settings.contextAwareness
    ? clampContext(captured, settings.maxContextChars)
    : withoutContext(captured);

  const request = buildLookupRequest({
    mode,
    context,
    targetLanguage: languageName(settings.targetLanguage),
  });
  return { request, context };
}
