/**
 * Translates the page a content script runs in, piece by piece: only the
 * text near the viewport, more as the page is scrolled or grows, and all of
 * it undone when translation is turned off.
 */
import type { LLMErrorKind, PageSegment } from "@lingo/core";
import {
  MAX_BATCH_SEGMENTS,
  type PageConfig,
  type PageEvent,
  type PageRequest,
} from "./protocol.ts";
import { applyTranslation, checkTranslation, restoreUnit } from "./rewrite.ts";
import {
  containersOf,
  flowsInline,
  isSkipped,
  scanHost,
  type Unit,
} from "./units.ts";

/** The part of a runtime port the translator uses. */
export interface TranslatorPort {
  postMessage(request: PageRequest): void;
  disconnect(): void;
  onMessage: { addListener(listener: (event: PageEvent) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface PageTranslationProgress {
  active: boolean;
  /** Pieces of text found so far. */
  units: number;
  translated: number;
  /** Waiting for a request, or in one. */
  pending: number;
  failed: number;
  /** Requests sent. */
  requests: number;
  /** Pieces translated from an earlier answer, without a request. */
  reused: number;
  /** Pieces shown translated without some of their formatting or links. */
  lossy: number;
  /** How often each kind of failure happened. */
  failures: Record<string, number>;
}

/**
 * Why translation has stopped and waits for the user:
 * - a kind of provider failure, as for a lookup
 * - `interrupted`: the background kept going away
 * - `updated`: the extension was reloaded or updated under this page
 */
export type PageProblem = LLMErrorKind | "interrupted" | "updated";

/** What an interface needs to know to show where page translation stands. */
export interface PageTranslationStatus {
  active: boolean;
  /** What the background said when translation started. */
  config?: PageConfig;
  problem?: PageProblem;
}

export interface PageTranslatorEnv {
  /** Opens a port to the background. Throws when the extension is gone. */
  connect(): TranslatorPort;
  /** Told when translation starts, stops, runs into a problem, or gets past it. */
  onStatus?(status: PageTranslationStatus): void;
  /**
   * Told when a piece of text starts or stops waiting for its translation,
   * so that the page can show which ones are on their way.
   */
  onPending?(unit: Unit, pending: boolean): void;
  /** Told whenever the numbers have changed. */
  onProgress?(progress: PageTranslationProgress): void;
}

export interface PageTranslator {
  readonly active: boolean;
  start(): void;
  /** Stops translating and puts the page back as it was. */
  stop(): void;
  /** Goes on after a problem, with what was waiting when it came up. */
  retry(): void;
}

/**
 * - `idle`: found, and not near the viewport yet
 * - `queued`: near the viewport, waiting for a request
 * - `sent`: in a request
 */
type State = "idle" | "queued" | "sent" | "done" | "failed";

const isPending = (state: State) => state === "queued" || state === "sent";

/** A translation, and whether it is used although it lacks some tags. */
interface Translation {
  text: string;
  lossy: boolean;
}

/** Failures of a request that a later one may not have. */
const PASSING: ReadonlySet<string> = new Set(["rate_limit", "network"]);

interface Tracked {
  unit: Unit;
  state: State;
  /** Whether the unit's host is in or near the viewport. */
  near: boolean;
  /** How often the unit was sent. */
  attempts: number;
  /**
   * Set after an answer whose tags did not fit. The unit is then sent again
   * in a request of its own, where the model has nothing else to mind.
   */
  alone: boolean;
}

/** A piece of text longer than this is left alone, in characters. */
const MAX_UNIT_CHARS = 8000;

/** How often one piece of text is sent before its failure is final. */
const MAX_ATTEMPTS = 2;

/** How long to hold back after the provider said to slow down. */
const RETRY_PAUSE_MS = 5000;

/**
 * How often the text of one element is read again because the page changed
 * it. A page that keeps rewriting an element would otherwise be translated
 * without end.
 */
const MAX_RESCANS = 8;

/** The elements that head a section of a page. */
const HEADING = /^h[1-6]$/;

/** How often the port may close in a row before translation gives up. */
const MAX_RECONNECTS = 3;

const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;
const isElement = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE;

/** The parent of a node, stepping out of a shadow tree to its host. */
const parentOf = (node: Node): Node | null =>
  node.parentNode ?? (node as Partial<ShadowRoot>).host ?? null;

export function createPageTranslator(env: PageTranslatorEnv): PageTranslator {
  let active = false;
  let config: PageConfig | undefined;
  let port: TranslatorPort | undefined;
  let waitingForPermit = false;
  /** Set when sending again will not help until the user has done something. */
  let problem: PageProblem | undefined;
  let pausedUntil = 0;
  let closedInARow = 0;
  let lastBatch = 0;
  let visibility: IntersectionObserver | undefined;
  let mutations: MutationObserver | undefined;

  const tracked = new Set<Tracked>();
  const byHost = new Map<Element, Set<Tracked>>();
  /** Which unit a node of the page belongs to. */
  let owners = new WeakMap<Node, Tracked>();
  /** Elements whose own text has been split into units. */
  let visited = new WeakSet<Element>();
  let nearHosts = new WeakSet<Element>();
  let rescans = new WeakMap<Element, number>();
  const queue = new Set<Tracked>();
  /** Per request, the units waiting for each of its segments. */
  const inFlight = new Map<number, Map<number, Tracked[]>>();
  /** Translations by source text. Kept when translation is turned off. */
  const cache = new Map<string, Translation>();
  const counts = {
    requests: 0,
    reused: 0,
    lossy: 0,
    failures: {} as Record<string, number>,
  };

  // ---- Reporting ----------------------------------------------------------

  let reportScheduled = false;
  function report() {
    if (reportScheduled || !env.onProgress) return;
    reportScheduled = true;
    queueMicrotask(() => {
      reportScheduled = false;
      const states = [...tracked].map((item) => item.state);
      const count = (...wanted: State[]) =>
        states.filter((state) => wanted.includes(state)).length;
      env.onProgress?.({
        active,
        units: tracked.size,
        translated: count("done"),
        pending: count("queued", "sent"),
        failed: count("failed"),
        requests: counts.requests,
        reused: counts.reused,
        lossy: counts.lossy,
        failures: { ...counts.failures },
      });
    });
  }

  const announce = () => env.onStatus?.({ active, config, problem });

  function setState(item: Tracked, state: State) {
    const before = isPending(item.state);
    item.state = state;
    if (before !== isPending(state)) env.onPending?.(item.unit, !before);
    report();
  }

  function fail(item: Tracked, reason: string) {
    counts.failures[reason] = (counts.failures[reason] ?? 0) + 1;
    setState(item, "failed");
  }

  /**
   * Stops asking until the user has dealt with the problem. What was waiting
   * shows its own text again, and stays in mind for `retry`.
   */
  function halt(reason: PageProblem) {
    problem = reason;
    for (const item of [...queue]) {
      queue.delete(item);
      setState(item, "idle");
    }
    announce();
  }

  // ---- Writing to the page ------------------------------------------------

  /**
   * Changes the page without the change being taken for the page's own:
   * the records of it are thrown away.
   */
  function write(change: () => void) {
    const earlier = mutations?.takeRecords() ?? [];
    change();
    mutations?.takeRecords();
    if (earlier.length > 0) queueMicrotask(() => onMutations(earlier));
  }

  function finish(item: Tracked, translation: Translation) {
    if (!tracked.has(item)) return;
    let failure: string | undefined;
    write(() => {
      failure = applyTranslation(item.unit, translation.text, translation);
    });
    if (failure) {
      fail(item, failure);
      return;
    }
    if (translation.lossy) counts.lossy += 1;
    for (const node of item.unit.created) owners.set(node, item);
    setState(item, "done");
  }

  // ---- Keeping track of units ---------------------------------------------

  /** Every node whose change means the unit's text has changed. */
  function* nodesOf(unit: Unit): Generator<Node> {
    for (const container of containersOf(unit)) {
      // A host can hold several runs, so it stands for none of them.
      const shared =
        container.parent === unit.host ||
        container.parent === unit.host.shadowRoot;
      if (!shared) yield container.parent;
      yield* container.original;
    }
    yield* unit.created;
  }

  function track(unit: Unit) {
    const item: Tracked = {
      unit,
      state: "idle",
      near: nearHosts.has(unit.host),
      attempts: 0,
      alone: false,
    };
    tracked.add(item);
    runs = undefined;
    for (const node of nodesOf(unit)) owners.set(node, item);

    let items = byHost.get(unit.host);
    if (!items) {
      items = new Set();
      byHost.set(unit.host, items);
      visibility?.observe(unit.host);
    }
    items.add(item);

    if (unit.source.length > MAX_UNIT_CHARS) fail(item, "too_long");
    else consider(item);
  }

  /** Forgets a unit, and takes its translation out of the page. */
  function drop(item: Tracked) {
    if (!tracked.delete(item)) return;
    runs = undefined;
    queue.delete(item);
    if (isPending(item.state)) env.onPending?.(item.unit, false);
    for (const node of nodesOf(item.unit)) owners.delete(node);

    const { host } = item.unit;
    const items = byHost.get(host);
    items?.delete(item);
    if (items?.size === 0) {
      byHost.delete(host);
      visibility?.unobserve(host);
    }
    if (item.unit.translated) write(() => restoreUnit(item.unit));
    report();
  }

  function dropHost(host: Element) {
    for (const item of [...(byHost.get(host) ?? [])]) drop(item);
  }

  /**
   * Splits the text of `host` into units, and that of the elements under it.
   * With `deep`, elements that were read before are read again.
   */
  function scan(host: Element, deep: boolean, fresh?: Set<Element>) {
    if (!config) return;
    dropHost(host);
    visited.add(host);
    fresh?.add(host);

    const found = scanHost(host);
    for (const root of found.shadowRoots) observe(root);
    for (const unit of found.units) track(unit);
    for (const child of found.children) {
      if (deep || !visited.has(child)) scan(child, deep, fresh);
    }
  }

  // ---- Deciding what to translate, and when --------------------------------

  /** Moves a unit on after its state or its place on the screen changed. */
  function consider(item: Tracked) {
    if (item.near && item.state === "idle") {
      const known = cache.get(item.unit.source);
      if (known !== undefined) {
        counts.reused += 1;
        finish(item, known);
      } else if (!problem) {
        queue.add(item);
        setState(item, "queued");
      }
    } else if (!item.near && item.state === "queued") {
      // Scrolled past before its turn came: not worth a request.
      queue.delete(item);
      setState(item, "idle");
    }
  }

  function onVisibility(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      if (entry.isIntersecting) nearHosts.add(entry.target);
      else nearHosts.delete(entry.target);
      for (const item of byHost.get(entry.target) ?? []) {
        item.near = entry.isIntersecting;
        consider(item);
      }
    }
    pump();
  }

  /** How far a unit is from being on screen, in pixels. */
  function distance(item: Tracked): number {
    const rect = item.unit.host.getBoundingClientRect();
    if (rect.bottom < 0) return -rect.bottom;
    if (rect.top > window.innerHeight) return rect.top - window.innerHeight;
    return 0;
  }

  /** The first node of a unit, by which units are put in page order. */
  const startOf = (item: Tracked): Node =>
    item.unit.root.original[0] ?? item.unit.root.parent;

  /**
   * A node and the hosts of the shadow trees it is in, from the inside out.
   * Two nodes of different trees have no order of their own, so they are
   * ordered by where their trees hang in the page.
   */
  function* outward(node: Node): Generator<Node> {
    for (let current: Node | undefined = node; current; ) {
      yield current;
      current = (current.getRootNode() as Partial<ShadowRoot>).host;
    }
  }

  function inPageOrder(a: Tracked, b: Tracked): number {
    const fromB = [...outward(startOf(b))];
    for (const nodeA of outward(startOf(a))) {
      const root = nodeA.getRootNode();
      const nodeB = fromB.find((node) => node.getRootNode() === root);
      if (!nodeB) continue;
      // One is inside the shadow tree of the other's ancestor. The light
      // children come first, as `scanHost` reads them.
      if (nodeA === nodeB) return nodeA === startOf(a) ? -1 : 1;
      const position = nodeA.compareDocumentPosition(nodeB);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    }
    return 0;
  }

  /**
   * The page's units cut into runs, in page order. Each run is what one
   * request holds. Worked out again after the page's units have changed.
   */
  let runs: Map<Tracked, Tracked[]> | undefined;

  /**
   * Cuts the units into runs of up to `batchChars` of text, from the top of
   * the page. Where a run ends depends on the text of the page alone, not on
   * the viewport or on what was translated when, so that the same page asks
   * the same requests each time, and the cache in the background can answer
   * them.
   *
   * A heading starts a new run once the run before it is half full. That way
   * runs fall back into step after a place where the page has changed.
   */
  function runOf(item: Tracked): Tracked[] {
    if (!runs) {
      const batchChars = config?.options.batchChars ?? 0;
      runs = new Map();
      let run: Tracked[] = [];
      let sources = new Set<string>();
      let chars = 0;
      const inOrder = [...tracked]
        .filter((each) => each.unit.source.length <= MAX_UNIT_CHARS)
        .sort(inPageOrder);
      for (const each of inOrder) {
        const { source } = each.unit;
        const added = sources.has(source) ? 0 : source.length;
        const full =
          run.length > 0 &&
          (chars + added > batchChars ||
            (added > 0 && sources.size >= MAX_BATCH_SEGMENTS) ||
            (HEADING.test(each.unit.host.localName) &&
              chars >= batchChars / 2));
        if (full) {
          run = [];
          sources = new Set();
          chars = 0;
        }
        run.push(each);
        if (!sources.has(source)) chars += source.length;
        sources.add(source);
        runs.set(each, run);
      }
    }
    return runs.get(item) ?? [item];
  }

  /** One segment of a request, and the units that wait for its answer. */
  interface Group {
    source: string;
    waiting: Tracked[];
  }

  /**
   * Picks what the next request holds: the run of the queued unit closest to
   * the viewport, whole. The units of the run that are farther away are
   * translated with it.
   *
   * A text of the run that is translated already, from an answer to another
   * run, is sent all the same: leaving it out would make the request depend
   * on which run was answered first. What a request of its own was sent for
   * before is not sent again.
   */
  function nextBatch(): Group[] {
    let closest: Tracked | undefined;
    let least = Number.POSITIVE_INFINITY;
    for (const item of queue) {
      const far = distance(item);
      if (far < least) {
        closest = item;
        least = far;
      }
    }
    if (!closest) return [];

    if (closest.alone) {
      const { source } = closest.unit;
      const same = [...queue].filter((item) => item.unit.source === source);
      return [{ source, waiting: same }];
    }

    const groups = new Map<string, Group>();
    for (const item of runOf(closest)) {
      const waits =
        !item.alone && (item.state === "queued" || item.state === "idle");
      const known = item.state === "done" && item.attempts === 0;
      if (!waits && !known) continue;
      const { source } = item.unit;
      let group = groups.get(source);
      if (!group) {
        group = { source, waiting: [] };
        groups.set(source, group);
      }
      if (waits) group.waiting.push(item);
    }
    return [...groups.values()];
  }

  /** Asks for leave to send a request, when there is something to send. */
  function pump() {
    if (!active || problem || waitingForPermit || queue.size === 0) return;
    if (Date.now() < pausedUntil) return;
    if (post({ type: "permit" })) waitingForPermit = true;
  }

  function send() {
    if (!config) return;
    const groups = nextBatch();
    if (groups.length === 0) return;

    lastBatch += 1;
    const waiting = new Map<number, Tracked[]>();
    const segments: PageSegment[] = [];
    groups.forEach((group, index) => {
      const id = index + 1;
      segments.push({ id, text: group.source });
      if (group.waiting.length > 0) waiting.set(id, group.waiting);
      for (const item of group.waiting) {
        item.attempts += 1;
        queue.delete(item);
        setState(item, "sent");
      }
    });
    inFlight.set(lastBatch, waiting);
    counts.requests += 1;
    post({
      type: "translate",
      batch: lastBatch,
      title: document.title.slice(0, 300) || undefined,
      segments,
    });
    report();
  }

  /** Puts a unit back in line after a request for it fell through. */
  function requeue(item: Tracked, reason: string) {
    if (!tracked.has(item)) return;
    if (item.attempts >= MAX_ATTEMPTS) {
      fail(item, reason);
      return;
    }
    setState(item, "idle");
    consider(item);
  }

  /** Takes a unit out of line, to be asked for afresh after a `retry`. */
  function shelve(item: Tracked) {
    if (!tracked.has(item)) return;
    item.attempts = 0;
    setState(item, "idle");
  }

  // ---- Talking to the background ------------------------------------------

  function connect(): TranslatorPort | undefined {
    try {
      const opened = env.connect();
      opened.onMessage.addListener(onEvent);
      opened.onDisconnect.addListener(() => {
        if (port === opened) onClosed();
      });
      port = opened;
      return opened;
    } catch {
      // The extension was reloaded or updated under this page.
      halt("updated");
      return undefined;
    }
  }

  function post(request: PageRequest): boolean {
    const open = port ?? connect();
    if (!open) return false;
    try {
      open.postMessage(request);
      return true;
    } catch {
      onClosed();
      return false;
    }
  }

  /** The background went away, as when the browser stops an idle worker. */
  function onClosed() {
    port = undefined;
    waitingForPermit = false;
    const interrupted = [...inFlight.values()].flatMap((batch) => [
      ...batch.values(),
    ]);
    inFlight.clear();
    if (!active) return;

    closedInARow += 1;
    if (closedInARow > MAX_RECONNECTS) {
      for (const item of interrupted.flat()) shelve(item);
      halt("interrupted");
      return;
    }
    // Being cut off is not the unit's failure, so it does not count as a try.
    for (const item of interrupted.flat()) {
      item.attempts -= 1;
      requeue(item, "interrupted");
    }
    // Opens a new port if there is still something to send.
    pump();
  }

  function onEvent(event: PageEvent) {
    switch (event.type) {
      case "config":
        if (!config) begin(event);
        return;
      case "permit":
        waitingForPermit = false;
        send();
        pump();
        return;
      case "segment": {
        closedInARow = 0;
        const batch = inFlight.get(event.batch);
        const items = batch?.get(event.id);
        const first = items?.[0];
        if (!items || !first) return;
        batch?.delete(event.id);

        const misfit = checkTranslation(first.unit, event.text);
        if (misfit && first.attempts < MAX_ATTEMPTS) {
          for (const item of items) {
            item.alone = true;
            requeue(item, misfit);
          }
          return;
        }
        // A second answer that does not fit either is used as far as it
        // goes: the text is translated, and what its lost tags stood for
        // is given up.
        const translation = { text: event.text, lossy: misfit !== undefined };
        cache.set(first.unit.source, translation);
        for (const item of items) finish(item, translation);
        // The page may have shown the same text again in the meantime.
        for (const item of [...queue]) {
          if (item.unit.source !== first.unit.source) continue;
          queue.delete(item);
          finish(item, translation);
        }
        return;
      }
      case "done": {
        const unanswered = inFlight.get(event.batch);
        inFlight.delete(event.batch);
        for (const items of unanswered?.values() ?? []) {
          for (const item of items) requeue(item, "unanswered");
        }
        pump();
        return;
      }
      case "error": {
        const lost = [...(inFlight.get(event.batch)?.values() ?? [])].flat();
        inFlight.delete(event.batch);

        if (event.kind === "refusal") {
          // The model declined this text. The rest of the page goes on.
          for (const item of lost) if (tracked.has(item)) fail(item, "refusal");
          pump();
          return;
        }
        const triedEnough = lost.some((item) => item.attempts >= MAX_ATTEMPTS);
        if (PASSING.has(event.kind) && !triedEnough) {
          pausedUntil = Date.now() + RETRY_PAUSE_MS;
          setTimeout(pump, RETRY_PAUSE_MS);
          for (const item of lost) requeue(item, event.kind);
          return;
        }
        // Nothing more will get through until the user steps in.
        for (const item of lost) shelve(item);
        halt(event.kind);
        return;
      }
      case "ping":
        return;
    }
  }

  // ---- Following the page as it changes -----------------------------------

  /**
   * The unit a changed node belongs to. `"untouched"` when the node is inside
   * kept text or a void, which a translation moves but never changes.
   */
  function ownerOf(node: Node): Tracked | "untouched" | undefined {
    for (
      let current: Node | null = node;
      current;
      current = parentOf(current)
    ) {
      const owner = owners.get(current);
      if (owner) {
        for (const slot of owner.unit.slots.values()) {
          if (slot.element === current && slot.kind !== "g") return "untouched";
        }
        return owner;
      }
      if (isElement(current) && visited.has(current)) return undefined;
    }
    return undefined;
  }

  /** The nearest element around a node whose text was split into units. */
  function hostOf(node: Node): Element | undefined {
    for (
      let current: Node | null = node;
      current;
      current = parentOf(current)
    ) {
      if (isElement(current) && visited.has(current)) return current;
    }
    return undefined;
  }

  function insideSkipped(node: Node) {
    for (
      let current: Node | null = node;
      current;
      current = parentOf(current)
    ) {
      if (isElement(current) && isSkipped(current)) return true;
    }
    return false;
  }

  function onMutations(records: MutationRecord[]) {
    if (!active || !config) return;
    /** Units whose text the page changed. */
    const stale = new Set<Tracked>();
    /** Elements whose own text has to be split again. */
    const changedHosts = new Set<Element>();
    /** Elements that are new to the page. */
    const added = new Set<Element>();
    let removedElements = false;

    const noteHost = (node: Node) => {
      const host = hostOf(node);
      if (host) changedHosts.add(host);
    };

    for (const record of records) {
      const { target } = record;
      if (insideSkipped(target)) continue;

      const owner = ownerOf(target);
      if (owner === "untouched") continue;
      if (owner) {
        // What the page wrote is now the text to put back on a restore.
        if (isText(target) && owner.unit.texts.has(target)) {
          owner.unit.texts.set(target, target.data);
        }
        stale.add(owner);
        continue;
      }
      if (record.type === "characterData") {
        noteHost(target);
        continue;
      }

      for (const node of record.removedNodes) {
        const lost = owners.get(node);
        if (lost) stale.add(lost);
        if (isElement(node)) removedElements = true;
      }
      for (const node of record.addedNodes) {
        if (isElement(node) && !flowsInline(node)) added.add(node);
        else if (isElement(node)) noteHost(target);
        else if (isText(node) && node.data.trim() !== "") noteHost(target);
      }
    }

    for (const item of stale) {
      changedHosts.add(item.unit.host);
      drop(item);
    }
    if (removedElements) {
      for (const host of [...byHost.keys()]) {
        if (!host.isConnected) dropHost(host);
      }
    }
    for (const host of changedHosts) {
      const count = (rescans.get(host) ?? 0) + 1;
      rescans.set(host, count);
      if (host.isConnected && count <= MAX_RESCANS) scan(host, false);
    }
    const fresh = new Set<Element>();
    for (const element of added) {
      if (!element.isConnected || fresh.has(element)) continue;
      if (insideSkipped(element)) continue;
      scan(element, true, fresh);
    }
    pump();
  }

  /** The page itself, and each open shadow root in it. */
  let observed = new WeakSet<Node>();
  function observe(root: Node) {
    if (observed.has(root)) return;
    observed.add(root);
    mutations?.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // ---- Turning on and off -------------------------------------------------

  function begin(received: PageConfig) {
    config = received;
    // A scroll margin widens the viewport and every scrolling box inside the
    // page alike. A root margin on top of it would count twice for the page
    // itself, so it is only the fallback where there is no scroll margin.
    const { aheadViewports } = received.options;
    const ahead = Math.round(aheadViewports * window.innerHeight);
    const margin = `${ahead}px 0px`;
    const init: IntersectionObserverInit & { scrollMargin?: string } =
      "scrollMargin" in IntersectionObserver.prototype
        ? { scrollMargin: margin }
        : { rootMargin: margin };
    visibility = new IntersectionObserver(onVisibility, init);
    mutations = new MutationObserver(onMutations);
    observed = new WeakSet();
    observe(document.body);
    scan(document.body, true);
    announce();
    report();
  }

  return {
    get active() {
      return active;
    },

    start() {
      if (active) return;
      active = true;
      problem = undefined;
      closedInARow = 0;
      announce();
      // The background answers with the options, which is what starts it.
      connect();
      report();
    },

    stop() {
      if (!active) return;
      active = false;
      const open = port;
      port = undefined;
      open?.disconnect();
      visibility?.disconnect();
      mutations?.disconnect();
      visibility = undefined;
      mutations = undefined;

      for (const item of tracked) {
        if (isPending(item.state)) env.onPending?.(item.unit, false);
        if (item.unit.translated) restoreUnit(item.unit);
      }
      tracked.clear();
      runs = undefined;
      byHost.clear();
      queue.clear();
      inFlight.clear();
      owners = new WeakMap();
      visited = new WeakSet();
      nearHosts = new WeakSet();
      rescans = new WeakMap();
      config = undefined;
      problem = undefined;
      waitingForPermit = false;
      pausedUntil = 0;
      announce();
      report();
    },

    retry() {
      if (!active || !problem) return;
      problem = undefined;
      closedInARow = 0;
      pausedUntil = 0;
      announce();
      for (const item of tracked) consider(item);
      pump();
    },
  };
}
