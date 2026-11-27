import {
  type CapturedContext,
  type LLMErrorKind,
  LOOKUP_MODES,
  PROVIDER_IDS,
} from "@lingo/core";
import { z } from "zod";

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
const pageText = z.string().min(1).optional().catch(undefined);

/**
 * Content scripts run inside web pages, so the background does not trust what
 * they send: the shape is checked, sizes are capped, and the context level is
 * worked out from the text instead of taken from the sender.
 */
const lookupRequestSchema = z.object({
  type: z.literal("start"),
  mode: z.enum(LOOKUP_MODES),
  context: z
    .object({
      selection: z.string().trim().min(1).max(MAX_SELECTION_CHARS),
      before: pageText,
      after: pageText,
      title: pageText,
      url: pageText,
    })
    .transform((context): CapturedContext => {
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
    }),
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

/** Longest API key a check accepts, in characters. Real keys are far shorter. */
const MAX_API_KEY_CHARS = 1000;

const runtimeMessageSchema = z.discriminatedUnion("type", [
  /**
   * Opens, closes, or toggles the settings drawer of a tab. The lookup card
   * and the drawer itself send it to the background, which passes it on to
   * the top frame of their tab. The background also sends it on its own when
   * the toolbar button is pressed. The top frame answers with a
   * `DrawerAnswer`.
   */
  z.object({
    type: z.literal("settings-drawer"),
    action: z.enum(["open", "close", "toggle"]),
  }),
  /**
   * The page inside the drawer to background: was this drawer opened by the
   * extension just now? The answer is `true` or `false`.
   */
  z.object({ type: z.literal("settings-drawer-grant") }),
  /** Background to content script, when the keyboard shortcut is pressed. */
  z.object({ type: z.literal("lookup-selection") }),
  /**
   * Asks about the page translation of a tab, or for a change to it. The
   * page bar, the settings, and frames inside a page send it to the
   * background, which passes it on to the top frame of their tab. The
   * background also sends it on its own when the shortcut is pressed. The
   * top frame answers with a `PageSwitchAnswer`.
   */
  z.object({
    type: z.literal("page-translation"),
    action: z.enum(["toggle", "stop", "retry", "query"]),
  }),
  /**
   * Background to every frame of a tab, after its top frame turned page
   * translation on or off: do the same.
   */
  z.object({ type: z.literal("page-translation-set"), on: z.boolean() }),
  /**
   * Background to the extension's own pages: the page translation of a tab
   * was turned on or off.
   */
  z.object({
    type: z.literal("page-translation-changed"),
    tabId: z.number().int(),
    on: z.boolean(),
  }),
  /**
   * Settings page to background: ask the provider whether it accepts a key.
   * The answer is a `KeyCheck`, which also lists the key's models.
   */
  z.object({
    type: z.literal("check-api-key"),
    provider: z.enum(PROVIDER_IDS),
    apiKey: z.string().min(1).max(MAX_API_KEY_CHARS),
  }),
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

const modelInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilities: z
    .object({
      effort: z.boolean().optional(),
      structuredOutput: z.boolean().optional(),
    })
    .optional(),
});

/**
 * What a provider said about a key, and the models the key can use when it
 * was accepted. Anything else, such as no answer at all, reads as the
 * provider not having been reached.
 */
export const keyCheckSchema = z
  .object({
    status: z.enum(["accepted", "rejected", "unreachable"]),
    models: z.array(modelInfoSchema),
  })
  .catch({ status: "unreachable", models: [] });

export type KeyCheck = z.infer<typeof keyCheckSchema>;

/** What the top frame did with a `settings-drawer` message. */
export const drawerAnswerSchema = z.enum(["opened", "closed", "unchanged"]);

export type DrawerAnswer = z.infer<typeof drawerAnswerSchema>;

/**
 * Whether the page of a tab is being translated, and which tab that is. No
 * answer, as from a page where Lingo does not run, reads as "it is not".
 */
export const pageSwitchAnswerSchema = z
  .object({ on: z.boolean(), tabId: z.number().int().optional() })
  .catch({ on: false });

export type PageSwitchAnswer = z.infer<typeof pageSwitchAnswerSchema>;

export type PageSwitchAction = Extract<
  RuntimeMessage,
  { type: "page-translation" }
>["action"];

export type DrawerAction = Extract<
  RuntimeMessage,
  { type: "settings-drawer" }
>["action"];
