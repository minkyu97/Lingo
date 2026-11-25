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
 * How page translation behaves. Stored by the background, which hands a
 * content script the options when it connects. Anything missing or invalid
 * falls back to its default.
 */
export const pageTranslationOptionsSchema = z
  .object({
    /** Most requests started in any one second, over all tabs. */
    requestsPerSecond: z.number().int().min(1).max(20).catch(3),
    /**
     * How far past the edge of the viewport text is translated before it is
     * scrolled to, in viewport heights.
     */
    aheadViewports: z.number().min(0).max(5).catch(1),
    /** How much text goes into one request, in characters. */
    batchChars: z.number().int().min(1).max(MAX_BATCH_CHARS).catch(1500),
    /** Whether the text of a link stays as it is. */
    keepLinkText: z.boolean().catch(false),
  })
  .catch({
    requestsPerSecond: 3,
    aheadViewports: 1,
    batchChars: 1500,
    keepLinkText: false,
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
 * Background to content script. The background is part of the extension and
 * trusted, so these are typed but not checked at run time.
 */
export type PageEvent =
  /** Sent once, right after the port opens. */
  | { type: "config"; options: PageTranslationOptions }
  /** One request may be sent now. */
  | { type: "permit" }
  /** The translation of one segment, sent as soon as the model finished it. */
  | { type: "segment"; batch: number; id: number; text: string }
  | { type: "done"; batch: number }
  | { type: "error"; batch: number; kind: LLMErrorKind; message: string }
  /** Keeps the service worker alive while the provider is silent. */
  | { type: "ping" };
