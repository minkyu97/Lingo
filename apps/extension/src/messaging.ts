import type { CapturedContext, LLMErrorKind, LookupMode } from "@lingo/core";

/** Name of the port a content script opens for one lookup. */
export const LOOKUP_PORT = "lingo:lookup";

/** Longest selection a lookup accepts, in characters. */
export const MAX_SELECTION_CHARS = 10_000;

/** Longest surrounding text accepted on each side before settings apply. */
const MAX_SIDE_CHARS = 8_000;

/** Content script to background: sent once, right after the port opens. */
export interface LookupRequest {
  type: "start";
  mode: LookupMode;
  context: CapturedContext;
}

/** Background to content script, over the lookup port. */
export type LookupEvent =
  /** The request is on its way. `context` is what was actually sent. */
  | { type: "started"; context: CapturedContext }
  | { type: "delta"; text: string }
  /** Keeps the service worker alive while the provider is silent. */
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; kind: LLMErrorKind; message: string };

/** One-off messages sent with `runtime.sendMessage` or `tabs.sendMessage`. */
export type RuntimeMessage =
  /** Content script to background. */
  | { type: "open-settings" }
  /** Background to content script, when the keyboard shortcut is pressed. */
  | { type: "lookup-selection" };

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isRecord(value)) return false;
  return value.type === "open-settings" || value.type === "lookup-selection";
}

/**
 * Validates a message that arrived on the lookup port. Content scripts run
 * inside web pages, so the background does not trust the shape of what they
 * send.
 */
export function parseLookupRequest(value: unknown): LookupRequest | undefined {
  if (!isRecord(value) || value.type !== "start") return undefined;
  if (value.mode !== "translate" && value.mode !== "define") return undefined;

  const context = value.context;
  if (!isRecord(context) || typeof context.selection !== "string") {
    return undefined;
  }
  const selection = context.selection.trim();
  if (selection === "" || selection.length > MAX_SELECTION_CHARS) {
    return undefined;
  }

  const before = text(context.before)?.slice(-MAX_SIDE_CHARS);
  const after = text(context.after)?.slice(0, MAX_SIDE_CHARS);
  return {
    type: "start",
    mode: value.mode,
    context: {
      selection,
      level: before || after ? "paragraph" : "none",
      before,
      after,
      title: text(context.title)?.slice(0, 300),
      url: text(context.url)?.slice(0, 2000),
    },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
