import type { CapturedContext, LLMErrorKind, LookupMode } from "@lingo/core";
import type { LookupStatus } from "@lingo/ui";
import type { LookupEvent } from "./messaging.ts";

/** Everything the lookup panel shows for one request. */
export interface LookupState {
  mode: LookupMode;
  /** What the content script captured, kept for retries and mode switches. */
  captured: CapturedContext;
  status: LookupStatus;
  text: string;
  /** The context the background actually sent, once it says so. */
  context?: CapturedContext;
  error?: { kind: LLMErrorKind; message: string };
}

export function initialLookupState(
  mode: LookupMode,
  captured: CapturedContext,
): LookupState {
  return { mode, captured, status: "loading", text: "" };
}

/** Folds one event from the background into the panel state. */
export function applyLookupEvent(
  state: LookupState,
  event: LookupEvent,
): LookupState {
  switch (event.type) {
    case "started":
      return { ...state, context: event.context };
    case "delta":
      return {
        ...state,
        status: "streaming",
        text: state.text + event.text,
      };
    case "done":
      return { ...state, status: "done" };
    case "error":
      return {
        ...state,
        status: "error",
        error: { kind: event.kind, message: event.message },
      };
    case "ping":
      return state;
  }
}
