import type { CapturedContext } from "@lingo/core";

/** Elements that usually hold one paragraph's worth of text. */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BODY",
  "DD",
  "DIV",
  "DT",
  "FIGCAPTION",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "P",
  "PRE",
  "SECTION",
  "TD",
  "TH",
]);

/**
 * Input types whose text selection can be read. Password fields are left out
 * on purpose: Lingo never reads them.
 */
const READABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel"]);

/**
 * Captures the current selection in the page together with the text around
 * it. Returns `undefined` when nothing readable is selected.
 */
export function captureContext(
  doc: Document = document,
): CapturedContext | undefined {
  const captured = captureFromField(doc) ?? captureFromRange(doc);
  if (!captured) return undefined;

  const hasSides = Boolean(captured.before || captured.after);
  return {
    selection: captured.selection,
    level: hasSides ? "paragraph" : "none",
    before: captured.before || undefined,
    after: captured.after || undefined,
    title: doc.title || undefined,
    url: pageUrl(doc),
  };
}

interface Sides {
  selection: string;
  before: string;
  after: string;
}

/** A selection inside a text field. The DOM Selection API does not see these. */
function captureFromField(doc: Document): Sides | undefined {
  const field = activeElement(doc);
  if (!isReadableField(field)) return undefined;

  const { value, selectionStart: start, selectionEnd: end } = field;
  if (start === null || end === null || start === end) return undefined;
  const selection = value.slice(start, end);
  if (selection.trim() === "") return undefined;

  return {
    selection,
    before: collapseWhitespace(value.slice(0, start)).trimStart(),
    after: collapseWhitespace(value.slice(end)).trimEnd(),
  };
}

/** A selection in ordinary page content. */
function captureFromRange(doc: Document): Sides | undefined {
  const selected = doc.getSelection();
  if (!selected || selected.rangeCount === 0 || selected.isCollapsed) {
    return undefined;
  }
  const selection = selected.toString();
  if (selection.trim() === "") return undefined;

  const range = selected.getRangeAt(0);
  const block = closestBlock(range.commonAncestorContainer);
  if (!block) return { selection, before: "", after: "" };

  let sides = textAround(range, block);
  if (!sides.before && !sides.after) {
    // The selection fills its block. Look one block further out, but not as
    // far as the whole page.
    const outer = closestBlock(block.parentNode);
    if (outer && outer.tagName !== "BODY") sides = textAround(range, outer);
  }
  return { selection, ...sides };
}

function textAround(
  range: Range,
  block: Element,
): { before: string; after: string } {
  const doc = block.ownerDocument;

  const head = doc.createRange();
  head.selectNodeContents(block);
  head.setEnd(range.startContainer, range.startOffset);

  const tail = doc.createRange();
  tail.selectNodeContents(block);
  tail.setStart(range.endContainer, range.endOffset);

  return {
    before: collapseWhitespace(head.toString()).trimStart(),
    after: collapseWhitespace(tail.toString()).trimEnd(),
  };
}

function closestBlock(node: Node | null): Element | undefined {
  let current: Node | null = node;
  while (current) {
    if (
      current.nodeType === 1 &&
      BLOCK_TAGS.has((current as Element).tagName)
    ) {
      return current as Element;
    }
    current = current.parentNode;
  }
  return undefined;
}

/** The focused element, looking through open shadow roots. */
function activeElement(doc: Document): Element | null {
  let element = doc.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}

function isReadableField(
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false;
  if (element.tagName === "TEXTAREA") return true;
  return (
    element.tagName === "INPUT" &&
    READABLE_INPUT_TYPES.has((element as HTMLInputElement).type)
  );
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** The page address without its query string or fragment, which can hold secrets. */
function pageUrl(doc: Document): string | undefined {
  try {
    const url = new URL(doc.URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}
