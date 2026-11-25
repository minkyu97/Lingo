/**
 * Splits a page into the units that are translated: runs of text and inline
 * elements that read as one paragraph. A unit keeps hold of the page's own
 * nodes, so a translation can be written into them and taken out again.
 */
import { escapeMarkupText } from "@lingo/core";

/** Child nodes of one parent that a translation fills and reorders. */
export interface Container {
  parent: ParentNode & Node;
  /** The nodes in the order the page had them. */
  original: ChildNode[];
  /** The nodes in the order they are in now. */
  current: ChildNode[];
}

/** `g`: a group whose text is translated. `k`: kept text. `x`: not text. */
export type SlotKind = "g" | "k" | "x";

/** An inline element of a unit, which the model sees as a numbered tag. */
export interface Slot {
  kind: SlotKind;
  /** The element that moves when a translation moves the tag. */
  element: Element;
  /** Where the element sits. */
  parent: Container;
  /** What a group holds. */
  content?: Container;
}

export interface Unit {
  /** The block-level element this text belongs to. */
  host: Element;
  root: Container;
  /** The unit's inline elements, by the number of their tag. */
  slots: Map<number, Slot>;
  /** The text sent to the model, with inline tags. */
  source: string;
  /** Every text node a translation may write to, and what the page had there. */
  texts: Map<Text, string>;
  /** Text nodes that a translation added. */
  created: Text[];
  /** Whitespace around the text, where the page preserves it. */
  lead: string;
  trail: string;
  translated: boolean;
}

export interface ScanOptions {
  /** Whether the text of a link stays as it is. */
  keepLinkText: boolean;
}

/** Elements that hold no text to translate. In a run, they are voids. */
const NOT_TEXT = new Set([
  "audio",
  "br",
  "canvas",
  "embed",
  "head",
  "iframe",
  "img",
  "input",
  "lingo-ui",
  "math",
  "noscript",
  "object",
  "picture",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
  "wbr",
]);

/** Elements whose text is code, or stands for input and output. */
const CODE = new Set(["code", "kbd", "pre", "samp", "tt", "var"]);

/** Class names that code editors and syntax highlighters put on their root. */
const CODE_CLASS =
  /(^|\s)(hljs|CodeMirror|cm-editor|monaco-editor|blob-code)(\s|$)/;

/** Used where the layout is unknown, as in a document that is not rendered. */
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
]);

const HAS_LETTER = /\p{L}/u;
/** The whitespace that HTML collapses. A no-break space is not part of it. */
const COLLAPSIBLE = /[ \t\n\r\f]+/g;

type Layout = "inline" | "block" | "none";

function layoutOf(element: Element): Layout {
  const display = getComputedStyle(element).display;
  if (display === "none") return "none";
  if (display === "contents" || /^(inline|ruby)/.test(display)) return "inline";
  if (display) return "block";
  return INLINE_TAGS.has(element.localName) ? "inline" : "block";
}

/** Whether the page says, or the element's kind implies, that its text stays. */
function isKept(element: Element, options: ScanOptions): boolean {
  if (CODE.has(element.localName)) return true;
  if (options.keepLinkText && element.localName === "a") return true;
  if (element.getAttribute("translate") === "no") return true;
  if (element.classList.contains("notranslate")) return true;
  if (CODE_CLASS.test(element.getAttribute("class") ?? "")) return true;
  const editable = element.getAttribute("contenteditable");
  return editable !== null && editable !== "false";
}

/** Whether nothing inside the element is translated. */
export function isSkipped(element: Element, options: ScanOptions): boolean {
  return NOT_TEXT.has(element.localName) || isKept(element, options);
}

/** Whether an element can be part of a run: inline, with nothing block-level inside. */
export function flowsInline(element: Element, options: ScanOptions): boolean {
  const layout = layoutOf(element);
  if (layout === "none") return true;
  if (layout === "block") return false;
  if (isSkipped(element, options)) return true;
  // A shadow tree is laid out in place of the children. Treat its host as a
  // block, so that the tree is scanned on its own.
  if (element.shadowRoot) return false;
  for (const child of element.children) {
    if (!flowsInline(child, options)) return false;
  }
  return true;
}

/** What a run is made of, before its tags are numbered. */
type Piece =
  | { type: "text"; text: string }
  | { type: "group"; element: Element; inner: Element; children: Piece[] }
  | { type: "keep"; element: Element; text: string }
  | { type: "void"; element: Element };

const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;
const isElement = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE;

const isBlank = (piece: Piece) =>
  piece.type === "text" && piece.text.trim() === "";

/** Whether the pieces hold any text that a translation would change. */
const hasWords = (pieces: Piece[]): boolean =>
  pieces.some(
    (piece) =>
      piece.type === "group" ||
      (piece.type === "text" && HAS_LETTER.test(piece.text)),
  );

function piecesOf(
  nodes: Iterable<ChildNode>,
  options: ScanOptions,
  preserve: boolean,
): Piece[] {
  const pieces: Piece[] = [];
  const readable = (text: string) =>
    preserve ? text : text.replace(COLLAPSIBLE, " ");

  for (const node of nodes) {
    if (isText(node)) {
      pieces.push({ type: "text", text: readable(node.data) });
      continue;
    }
    if (!isElement(node)) continue;

    const text = readable(node.textContent ?? "").trim();
    if (
      NOT_TEXT.has(node.localName) ||
      layoutOf(node) === "none" ||
      text === ""
    ) {
      pieces.push({ type: "void", element: node });
      continue;
    }
    if (isKept(node, options)) {
      pieces.push({ type: "keep", element: node, text });
      continue;
    }

    const children = piecesOf(node.childNodes, options, preserve);
    if (!hasWords(children)) {
      // Numbers, symbols, or kept text only. Nothing in it to translate.
      pieces.push({ type: "keep", element: node, text });
      continue;
    }
    // An element that only wraps another one, as in <b><a>…</a></b>, shares
    // a tag with it.
    const [only, ...others] = children.filter((child) => !isBlank(child));
    if (only?.type === "group" && others.length === 0) {
      pieces.push({ ...only, element: node });
    } else {
      pieces.push({ type: "group", element: node, inner: node, children });
    }
  }
  return pieces;
}

const containerOf = (
  parent: ParentNode & Node,
  nodes: ChildNode[],
): Container => ({ parent, original: nodes, current: nodes });

/** Writes the pieces as tagged text, and records which element each tag is. */
function render(pieces: Piece[], container: Container, unit: Unit): string {
  let text = "";
  for (const piece of pieces) {
    if (piece.type === "text") {
      text += escapeMarkupText(piece.text);
      continue;
    }
    const id = unit.slots.size + 1;
    if (piece.type === "void") {
      unit.slots.set(id, {
        kind: "x",
        element: piece.element,
        parent: container,
      });
      text += `<x${id}/>`;
    } else if (piece.type === "keep") {
      unit.slots.set(id, {
        kind: "k",
        element: piece.element,
        parent: container,
      });
      text += `<k${id}>${escapeMarkupText(piece.text)}</k${id}>`;
    } else {
      const content = containerOf(piece.inner, [...piece.inner.childNodes]);
      unit.slots.set(id, {
        kind: "g",
        element: piece.element,
        parent: container,
        content,
      });
      text += `<g${id}>${render(piece.children, content, unit)}</g${id}>`;
    }
  }
  return text;
}

/** Every container of a unit: its root, and the inside of each group. */
export function containersOf(unit: Unit): Container[] {
  const containers = [unit.root];
  for (const slot of unit.slots.values()) {
    if (slot.content) containers.push(slot.content);
  }
  return containers;
}

function preservesWhitespace(parent: Node): boolean {
  const element = isElement(parent) ? parent : (parent as ShadowRoot).host;
  const style = getComputedStyle(element);
  const collapse = style.getPropertyValue("white-space-collapse");
  if (collapse) return collapse !== "collapse";
  return /^(pre|break-spaces)/.test(style.whiteSpace);
}

/** Builds the unit for one run of inline nodes, if it has text to translate. */
function buildUnit(
  host: Element,
  parent: ParentNode & Node,
  nodes: ChildNode[],
  options: ScanOptions,
): Unit | undefined {
  const preserve = preservesWhitespace(parent);
  let pieces = piecesOf(nodes, options, preserve);
  let root = containerOf(parent, nodes);

  // A run that is one element, as in <li><a>Home</a></li>, needs no tag: the
  // translation goes straight into that element.
  const [only, ...others] = pieces.filter((piece) => !isBlank(piece));
  if (only?.type === "group" && others.length === 0) {
    pieces = only.children;
    root = containerOf(only.inner, [...only.inner.childNodes]);
  }
  if (!hasWords(pieces)) return undefined;

  const unit: Unit = {
    host,
    root,
    slots: new Map(),
    source: "",
    texts: new Map(),
    created: [],
    lead: "",
    trail: "",
    translated: false,
  };
  const text = render(pieces, root, unit);
  unit.source = text.trim();
  if (preserve) {
    unit.lead = text.slice(0, text.length - text.trimStart().length);
    unit.trail = text.slice(text.trimEnd().length);
  }
  for (const container of containersOf(unit)) {
    for (const node of container.original) {
      if (isText(node)) unit.texts.set(node, node.data);
    }
  }
  return unit;
}

export interface HostScan {
  /** The units made of the host's own text. */
  units: Unit[];
  /** Elements under the host that hold text of their own. */
  children: Element[];
  /** Open shadow roots found on the way. Changes inside them are not seen from outside. */
  shadowRoots: ShadowRoot[];
}

/**
 * Splits the direct content of `host` into units. Each run of text and
 * inline elements between two block-level children is one unit.
 */
export function scanHost(host: Element, options: ScanOptions): HostScan {
  const scan: HostScan = { units: [], children: [], shadowRoots: [] };
  if (isSkipped(host, options)) return scan;

  const scanChildren = (parent: ParentNode & Node) => {
    let run: ChildNode[] = [];
    const flush = () => {
      const unit = run.some((node) => isElement(node) || isText(node))
        ? buildUnit(host, parent, run, options)
        : undefined;
      if (unit) scan.units.push(unit);
      run = [];
    };

    for (const node of parent.childNodes) {
      if (isElement(node) && !flowsInline(node, options)) {
        flush();
        if (!isSkipped(node, options)) scan.children.push(node);
      } else {
        run.push(node);
      }
    }
    flush();
  };

  scanChildren(host);
  if (host.shadowRoot) {
    scan.shadowRoots.push(host.shadowRoot);
    scanChildren(host.shadowRoot);
  }
  return scan;
}
