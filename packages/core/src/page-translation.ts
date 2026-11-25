/**
 * The text protocol of page translation.
 *
 * A page is translated in segments: one paragraph-sized piece of text each.
 * Formatting and links inside a segment travel as numbered inline tags, so
 * the model can move them to where they belong in the translated sentence
 * and the page can put its own elements back around the right words:
 *
 * - `<g1>…</g1>` a group: text with its own formatting, or a link
 * - `<k2>…</k2>` kept text: shown to the model, but never changed
 * - `<x3/>`      something that is not text, such as an image
 *
 * The characters `<`, `>` and `&` of the page's own text are escaped, so a
 * tag can always be told from text.
 */
import prompts from "@lingo/spec/prompts.json" with { type: "json" };
import type { ChatRequest } from "./llm.ts";

export interface PageSegment {
  /** Identifies the segment within one request. */
  id: number;
  /** The segment's text, with inline tags. */
  text: string;
}

export interface PageTranslationInput {
  segments: readonly PageSegment[];
  /** English name of the language to translate into, such as "Korean". */
  targetLanguage: string;
  /** The page's title, as a hint of what the page is about. */
  title?: string;
}

/** Builds the model request that translates a batch of segments. */
export function buildPageTranslationRequest(
  input: PageTranslationInput,
): ChatRequest {
  const lines: string[] = [];
  if (input.title) {
    lines.push(`<title>${escapeMarkupText(input.title)}</title>`);
  }
  for (const segment of input.segments) {
    lines.push(`<seg id="${segment.id}">${segment.text}</seg>`);
  }
  return {
    system: prompts.pageTranslation.system
      .join("\n")
      .replaceAll("{{targetLanguage}}", input.targetLanguage),
    messages: [{ role: "user", content: lines.join("\n") }],
  };
}

const SEGMENT = /<seg id="(\d+)">([\s\S]*?)<\/seg>/g;

/**
 * Reads translated segments out of a streamed answer. Each call to `push`
 * returns the segments that the new text completed. Anything outside a
 * segment is ignored.
 */
export function createSegmentReader(): {
  push(chunk: string): PageSegment[];
} {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const complete: PageSegment[] = [];
      let consumed = 0;
      for (const match of buffer.matchAll(SEGMENT)) {
        complete.push({ id: Number(match[1]), text: match[2] ?? "" });
        consumed = match.index + match[0].length;
      }
      buffer = buffer.slice(consumed);
      return complete;
    },
  };
}

/** A segment's text as a tree: what its inline tags wrap. */
export type MarkupNode =
  | { type: "text"; text: string }
  | { type: "group"; id: number; children: MarkupNode[] }
  | { type: "keep"; id: number }
  | { type: "void"; id: number };

const TAG = /<(\/?)([gkx])(\d+)\s*(\/?)>/g;

/**
 * Parses a segment's text into a tree. Returns `undefined` when its tags do
 * not pair up. What a kept tag wraps is dropped: the page has the original.
 */
export function parseMarkup(text: string): MarkupNode[] | undefined {
  const root: MarkupNode[] = [];
  const open: { kind: string; id: number; children: MarkupNode[] }[] = [];
  const current = () => open.at(-1)?.children ?? root;
  const addText = (raw: string) => {
    if (raw) current().push({ type: "text", text: unescapeMarkupText(raw) });
  };
  const close = (kind: string, id: number, children: MarkupNode[]) => {
    current().push(
      kind === "g" ? { type: "group", id, children } : { type: "keep", id },
    );
  };

  let position = 0;
  for (const match of text.matchAll(TAG)) {
    addText(text.slice(position, match.index));
    position = match.index + match[0].length;

    const closing = match[1] === "/";
    const kind = match[2] ?? "";
    const id = Number(match[3]);
    const selfClosing = match[4] === "/";

    if (kind === "x") {
      // Written as `<x1/>`. A model may also write `<x1>` or `<x1></x1>`.
      if (!closing) current().push({ type: "void", id });
    } else if (selfClosing) {
      close(kind, id, []);
    } else if (!closing) {
      open.push({ kind, id, children: [] });
    } else {
      const last = open.pop();
      if (!last || last.kind !== kind || last.id !== id) return undefined;
      close(kind, id, last.children);
    }
  }
  addText(text.slice(position));
  return open.length === 0 ? root : undefined;
}

/** Escapes the page's own text, so that it cannot be read as a tag. */
export function escapeMarkupText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function unescapeMarkupText(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}
