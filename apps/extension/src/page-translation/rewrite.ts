/**
 * Writes a translation into the page, and takes it out again.
 *
 * The page's own nodes are reused: an inline element is moved to where the
 * translation puts its tag, and text goes into the text nodes that were
 * there. No node of the page is removed or given another parent. That keeps
 * every style, link, and event listener, and it keeps the nodes where the
 * page's own scripts expect to find them.
 */
import { type MarkupNode, parseMarkup } from "@lingo/core";
import {
  type Container,
  containersOf,
  type SlotKind,
  type Unit,
} from "./units.ts";

/**
 * Why a translation could not be used:
 * - `unpaired`: its tags do not pair up
 * - `missing`: it lacks a tag of the segment
 * - `detached`: the page has taken the text away in the meantime
 */
export type RewriteFailure = "unpaired" | "missing" | "detached";

const KIND: Record<Exclude<MarkupNode["type"], "text">, SlotKind> = {
  group: "g",
  keep: "k",
  void: "x",
};

const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;

/**
 * Checks a translation against the unit it is for, and works out what each
 * container is to hold.
 *
 * A tag that does not fit is taken off, and the words it wrapped stay: a tag
 * the unit does not have, one that was used already, or one that sits inside
 * another tag than before. What cannot be mended is a tag of the unit that
 * is nowhere in the translation, because there is no telling where its
 * element belongs. That is the reason returned.
 */
function plan(
  unit: Unit,
  translation: string,
): Map<Container, MarkupNode[]> | RewriteFailure {
  const tree = parseMarkup(translation.trim());
  if (!tree) return "unpaired";

  const plans = new Map<Container, MarkupNode[]>();
  const placed = new Set<number>();
  const fit = (nodes: MarkupNode[], container: Container): MarkupNode[] => {
    const fitting: MarkupNode[] = [];
    for (const node of nodes) {
      if (node.type === "text") {
        fitting.push(node);
        continue;
      }
      const slot = unit.slots.get(node.id);
      const fits =
        slot !== undefined &&
        slot.kind === KIND[node.type] &&
        slot.parent === container &&
        !placed.has(node.id);
      if (!fits) {
        if (node.type === "group")
          fitting.push(...fit(node.children, container));
        continue;
      }
      placed.add(node.id);
      fitting.push(node);
      if (node.type === "group" && slot.content) {
        plans.set(slot.content, fit(node.children, slot.content));
      }
    }
    return fitting;
  };
  plans.set(unit.root, fit(tree, unit.root));
  return placed.size === unit.slots.size ? plans : "missing";
}

/** Why a translation does not fit the unit's tags, if it does not. */
export function checkTranslation(
  unit: Unit,
  translation: string,
): RewriteFailure | undefined {
  const plans = plan(unit, translation);
  return typeof plans === "string" ? plans : undefined;
}

/**
 * Replaces the unit's text with a translation. Returns the reason when the
 * translation cannot be used, in which case the page is left as it was.
 */
export function applyTranslation(
  unit: Unit,
  translation: string,
): RewriteFailure | undefined {
  const plans = plan(unit, translation);
  if (typeof plans === "string") return plans;
  if (!isAttached(unit)) return "detached";

  for (const [container, nodes] of plans) {
    const edges = container === unit.root ? unit : { lead: "", trail: "" };
    fill(unit, container, nodes, edges);
  }
  unit.translated = true;
  return undefined;
}

/** Puts back the nodes and the text that the page had. */
export function restoreUnit(unit: Unit): void {
  for (const node of unit.created) node.remove();
  for (const container of containersOf(unit)) {
    container.current = container.current.filter(
      (node) => !unit.created.includes(node as Text),
    );
    place(container, container.original);
  }
  unit.created = [];
  for (const [node, data] of unit.texts) {
    if (node.data !== data) node.data = data;
  }
  unit.translated = false;
}

/** Whether every node of the unit is still where the page had it. */
function isAttached(unit: Unit): boolean {
  return containersOf(unit).every(
    (container) =>
      container.parent.isConnected &&
      container.current.every((node) => node.parentNode === container.parent),
  );
}

function fill(
  unit: Unit,
  container: Container,
  nodes: MarkupNode[],
  edges: { lead: string; trail: string },
): void {
  // The page's own text nodes carry the translated text, in order.
  const carriers = container.original.filter(isText);
  const desired: ChildNode[] = [];
  let text = edges.lead;

  const flushText = () => {
    if (text === "") return;
    let carrier = carriers.shift();
    if (!carrier) {
      carrier = container.parent.ownerDocument?.createTextNode("") as Text;
      unit.created.push(carrier);
    }
    carrier.data = text;
    desired.push(carrier);
    text = "";
  };

  for (const node of nodes) {
    if (node.type === "text") {
      text += node.text;
      continue;
    }
    flushText();
    const slot = unit.slots.get(node.id);
    if (slot) desired.push(slot.element);
  }
  text += edges.trail;
  flushText();

  // What the translation has no use for stays in the page: a text node is
  // emptied, and anything else, such as a comment, is left as it is.
  for (const node of container.current) {
    if (desired.includes(node)) continue;
    if (isText(node)) node.data = "";
    desired.push(node);
  }
  place(container, desired);
}

/**
 * Puts the container's nodes in the given order, at the place in the parent
 * where they are now. Only a node that is out of place is moved.
 */
function place(container: Container, desired: ChildNode[]): void {
  const { parent } = container;
  const inPlace = (node: ChildNode) => node.parentNode === parent;
  // A node of the page that the page has since removed stays removed.
  const nodes = desired.filter(
    (node) => inPlace(node) || !container.current.includes(node),
  );

  let reference = container.current.findLast(inPlace)?.nextSibling ?? null;
  for (const node of nodes.toReversed()) {
    if (!inPlace(node) || node.nextSibling !== reference) {
      move(parent, node, reference);
    }
    reference = node;
  }
  container.current = nodes;
}

interface MovableParent {
  moveBefore?(node: Node, reference: Node | null): void;
}

/**
 * `moveBefore` moves a node without resetting it: an inline frame keeps its
 * page and an animation keeps running. It only takes a node that is already
 * in the document.
 */
function move(parent: Node, node: ChildNode, reference: Node | null): void {
  const movable = parent as MovableParent;
  if (node.parentNode === parent && movable.moveBefore) {
    movable.moveBefore(node, reference);
  } else {
    parent.insertBefore(node, reference);
  }
}
