import {
  type CapturedContext,
  type LLMErrorKind,
  LOOKUP_MODES,
} from "@lingo/core";
import * as z from "zod/mini";

/** Name of the port a content script opens for one lookup. */
export const LOOKUP_PORT = "lingo:lookup";

/** Longest selection a lookup accepts, in characters. */
export const MAX_SELECTION_CHARS = 10_000;

/** Longest surrounding text accepted on each side before settings apply. */
const MAX_SIDE_CHARS = 8_000;

/**
 * An optional piece of text from the page. Anything that is not text with
 * something in it reads as absent, rather than failing the whole message.
 */
const pageText = z.catch(
  z.optional(z.string().check(z.minLength(1))),
  undefined,
);

/**
 * Content scripts run inside web pages, so the background does not trust what
 * they send: the shape is checked, sizes are capped, and the context level is
 * worked out from the text instead of taken from the sender.
 */
const lookupRequestSchema = z.object({
  type: z.literal("start"),
  mode: z.enum(LOOKUP_MODES),
  context: z.pipe(
    z.object({
      selection: z
        .string()
        .check(z.trim(), z.minLength(1), z.maxLength(MAX_SELECTION_CHARS)),
      before: pageText,
      after: pageText,
      title: pageText,
      url: pageText,
    }),
    z.transform(
      (context: {
        selection: string;
        before?: string;
        after?: string;
        title?: string;
        url?: string;
      }): CapturedContext => {
        const before = context.before?.slice(-MAX_SIDE_CHARS);
        const after = context.after?.slice(0, MAX_SIDE_CHARS);
        return {
          selection: context.selection,
          level: before || after ? "paragraph" : "none",
          before,
          after,
          title: context.title?.slice(0, 300),
          url: context.url?.slice(0, 2000),
        };
      },
    ),
  ),
});

/** Content script to background: sent once, right after the port opens. */
export type LookupRequest = z.infer<typeof lookupRequestSchema>;

/**
 * Background to content script, over the lookup port. The background is part
 * of the extension and trusted, so these are typed but not checked at run
 * time.
 */
export type LookupEvent =
  /** The request is on its way. `context` is what was actually sent. */
  | { type: "started"; context: CapturedContext }
  | { type: "delta"; text: string }
  /** Keeps the service worker alive while the provider is silent. */
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; kind: LLMErrorKind; message: string };

/** Name of the keyboard command declared in the manifest. */
export const LOOKUP_COMMAND = "lookup-selection";

const runtimeMessageSchema = z.discriminatedUnion("type", [
  /** Content script to background. */
  z.object({ type: z.literal("open-settings") }),
  /** Background to content script, when the keyboard shortcut is pressed. */
  z.object({ type: z.literal("lookup-selection") }),
]);

/** One-off messages sent with `runtime.sendMessage` or `tabs.sendMessage`. */
export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return runtimeMessageSchema.safeParse(value).success;
}

/**
 * Reads a message that arrived on the lookup port. Returns `undefined` for
 * anything that is not a valid request.
 */
export function parseLookupRequest(value: unknown): LookupRequest | undefined {
  const parsed = lookupRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
