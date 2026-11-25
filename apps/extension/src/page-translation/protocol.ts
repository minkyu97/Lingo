/**
 * What a content script and the background say to each other over the page
 * translation port. One port serves one frame for as long as its page is
 * being translated.
 */
import type { LLMErrorKind } from "@lingo/core";
import { z } from "zod";

/** Name of the port a content script opens to have its page translated. */
export const PAGE_TRANSLATION_PORT = "lingo:page-translation";

/** Name of the keyboard command that turns page translation on and off. */
export const PAGE_TRANSLATION_COMMAND = "translate-page";

/** Most segments one request may hold. */
export const MAX_BATCH_SEGMENTS = 40;

/** Longest text one request may hold, in characters. */
export const MAX_BATCH_CHARS = 20_000;

/**
 * How page translation is tuned. These are not offered in settings: the
 * defaults are meant to be right, and end-to-end tests change them to make
 * a small page behave like a large one. The background hands a content
 * script the options when it connects. Anything missing or invalid falls
 * back to its default.
 */
export const pageTranslationOptionsSchema = z
  .object({
    /**
     * How far past the edge of the viewport text is translated before it is
     * scrolled to, in viewport heights.
     */
    aheadViewports: z.number().min(0).max(5).catch(1),
    /** How much text goes into one request, in characters. */
    batchChars: z.number().int().min(1).max(MAX_BATCH_CHARS).catch(1500),
  })
  .catch({
    aheadViewports: 1,
    batchChars: 1500,
  });

export type PageTranslationOptions = z.infer<
  typeof pageTranslationOptionsSchema
>;

/**
 * Content script to background. A content script runs inside a web page, so
 * the shape is checked and the sizes are capped.
 */
const pageRequestSchema = z.discriminatedUnion("type", [
  /** Asks for leave to send one request. Answered when the rate allows it. */
  z.object({ type: z.literal("permit") }),
  z.object({
    type: z.literal("translate"),
    /** Identifies the request on this port. */
    batch: z.number().int(),
    title: z.string().max(300).optional().catch(undefined),
    segments: z
      .array(z.object({ id: z.number().int(), text: z.string().min(1) }))
      .min(1)
      .max(MAX_BATCH_SEGMENTS)
      .refine(
        (segments) =>
          segments.reduce((sum, segment) => sum + segment.text.length, 0) <=
          MAX_BATCH_CHARS,
      ),
  }),
]);

export type PageRequest = z.infer<typeof pageRequestSchema>;

export function parsePageRequest(value: unknown): PageRequest | undefined {
  const parsed = pageRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * What a content script is told when its port opens. It cannot read the
 * settings itself, so this carries the ones it needs.
 */
export interface PageConfig {
  options: PageTranslationOptions;
  /** BCP 47 tag of the language the page is translated into. */
  targetLanguage: string;
  /** The name of the provider that translates, such as "Anthropic". */
  provider: string;
}

/**
 * Background to content script. The background is part of the extension and
 * trusted, so these are typed but not checked at run time.
 */
export type PageEvent =
  /** Sent once, right after the port opens. */
  | ({ type: "config" } & PageConfig)
  /** One request may be sent now. */
  | { type: "permit" }
  /** The translation of one segment, sent as soon as the model finished it. */
  | { type: "segment"; batch: number; id: number; text: string }
  | { type: "done"; batch: number }
  | { type: "error"; batch: number; kind: LLMErrorKind; message: string }
  /** Keeps the service worker alive while the provider is silent. */
  | { type: "ping" };
