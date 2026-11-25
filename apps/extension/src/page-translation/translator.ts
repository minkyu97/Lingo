/**
 * Translates the page a content script runs in, piece by piece: only the
 * text near the viewport, more as the page is scrolled or grows, and all of
 * it undone when translation is turned off.
 */
import type { PageSegment } from "@lingo/core";
import {
  MAX_BATCH_SEGMENTS,
  type PageEvent,
  type PageRequest,
  type PageTranslationOptions,
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
  /** How often each kind of failure happened. */
  failures: Record<string, number>;
}

export interface PageTranslatorEnv {
  /** Opens a port to the background. Throws when the extension is gone. */
  connect(): TranslatorPort;
  /** Told whenever the numbers have changed. */
  onProgress?(progress: PageTranslationProgress): void;
}

export interface PageTranslator {
  readonly active: boolean;
  start(): void;
  /** Stops translating and puts the page back as it was. */
  stop(): void;
}

/**
 * - `idle`: found, and not near the viewport yet
 * - `queued`: near the viewport, waiting for a request
 * - `sent`: in a request
 */
type State = "idle" | "queued" | "sent" | "done" | "failed";

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

/** How often one piece of text is sent again after a failure that may pass. */
const MAX_ATTEMPTS = 2;

/** How long to hold back after the provider said to slow down. */
const RETRY_PAUSE_MS = 5000;

/**
 * How often the text of one element is read again because the page changed
 * it. A page that keeps rewriting an element would otherwise be translated
 * without end.
 */
const MAX_RESCANS = 8;

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
  let options: PageTranslationOptions | undefined;
  let port: TranslatorPort | undefined;
  let waitingForPermit = false;
  /** Set by a failure that sending again will not fix, such as a missing key. */
  let halted = false;
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
  const cache = new Map<string, string>();
  const counts = {
    requests: 0,
    reused: 0,
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
        failures: { ...counts.failures },
      });
    });
  }

  function fail(item: Tracked, reason: string) {
    item.state = "failed";
    counts.failures[reason] = (counts.failures[reason] ?? 0) + 1;
    report();
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

  function finish(item: Tracked, translation: string) {
    if (!tracked.has(item)) return;
    let failure: string | undefined;
    write(() => {
      failure = applyTranslation(item.unit, translation);
    });
    if (failure) {
      fail(item, failure);
      return;
    }
    item.state = "done";
    for (const node of item.unit.created) owners.set(node, item);
    report();
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
    queue.delete(item);
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
    if (!options) return;
    dropHost(host);
    visited.add(host);
    fresh?.add(host);

    const found = scanHost(host, options);
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
      } else {
        item.state = "queued";
        queue.add(item);
      }
    } else if (!item.near && item.state === "queued") {
      // Scrolled past before its turn came: not worth a request.
      item.state = "idle";
      queue.delete(item);
    }
    report();
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

  const inPageOrder = (a: Tracked, b: Tracked) => {
    const first = (item: Tracked) =>
      item.unit.root.original[0] ?? item.unit.root.parent;
    const position = first(a).compareDocumentPosition(first(b));
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  };

  /**
   * Picks the units of the next request: what is on screen first, then what
   * is closest to it, up to the size of one request. Units with the same
   * text share a segment.
   */
  function nextBatch(batchChars: number): Tracked[][] {
    const distances = new Map<Tracked, number>();
    for (const item of queue) distances.set(item, distance(item));
    const closestFirst = [...queue].sort(
      (a, b) => (distances.get(a) ?? 0) - (distances.get(b) ?? 0),
    );

    const [closest] = closestFirst;
    if (closest?.alone) {
      const same = (item: Tracked) => item.unit.source === closest.unit.source;
      return [closestFirst.filter(same)];
    }

    const groups = new Map<string, Tracked[]>();
    let chars = 0;
    for (const item of closestFirst) {
      if (item.alone) continue;
      const { source } = item.unit;
      const group = groups.get(source);
      if (group) {
        group.push(item);
        continue;
      }
      const full =
        groups.size >= MAX_BATCH_SEGMENTS ||
        (groups.size > 0 && chars + source.length > batchChars);
      if (full) continue;
      groups.set(source, [item]);
      chars += source.length;
    }
    // Sent in page order, so that the model reads them as running text.
    return [...groups.values()].sort((a, b) =>
      a[0] && b[0] ? inPageOrder(a[0], b[0]) : 0,
    );
  }

  /** Asks for leave to send a request, when there is something to send. */
  function pump() {
    if (!active || halted || waitingForPermit || queue.size === 0) return;
    if (Date.now() < pausedUntil) return;
    if (post({ type: "permit" })) waitingForPermit = true;
  }

  function send() {
    if (!options) return;
    const groups = nextBatch(options.batchChars);
    if (groups.length === 0) return;

    lastBatch += 1;
    const waiting = new Map<number, Tracked[]>();
    const segments: PageSegment[] = [];
    groups.forEach((group, index) => {
      const id = index + 1;
      waiting.set(id, group);
      segments.push({ id, text: group[0]?.unit.source ?? "" });
      for (const item of group) {
        item.state = "sent";
        item.attempts += 1;
        queue.delete(item);
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
    item.state = "idle";
    consider(item);
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
      halted = true;
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
    for (const item of interrupted.flat()) requeue(item, "interrupted");
    if (!active) return;

    closedInARow += 1;
    if (closedInARow > MAX_RECONNECTS) halted = true;
    // Opens a new port if there is still something to send.
    pump();
  }

  function onEvent(event: PageEvent) {
    switch (event.type) {
      case "config":
        if (!options) begin(event.options);
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

        const failure = checkTranslation(first.unit, event.text);
        if (failure) {
          for (const item of items) {
            item.alone = true;
            requeue(item, failure);
          }
          return;
        }
        cache.set(first.unit.source, event.text);
        for (const item of items) finish(item, event.text);
        // The page may have shown the same text again in the meantime.
        for (const item of [...queue]) {
          if (item.unit.source !== first.unit.source) continue;
          queue.delete(item);
          finish(item, event.text);
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
        const lost = inFlight.get(event.batch);
        inFlight.delete(event.batch);
        const mayPass = event.kind === "rate_limit" || event.kind === "network";
        if (mayPass) {
          pausedUntil = Date.now() + RETRY_PAUSE_MS;
          setTimeout(pump, RETRY_PAUSE_MS);
        }
        if (event.kind === "missing_key" || event.kind === "auth") {
          halted = true;
        }
        for (const items of lost?.values() ?? []) {
          for (const item of items) {
            if (mayPass) requeue(item, event.kind);
            else if (tracked.has(item)) fail(item, event.kind);
          }
        }
        pump();
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

  function insideSkipped(node: Node, settings: PageTranslationOptions) {
    for (
      let current: Node | null = node;
      current;
      current = parentOf(current)
    ) {
      if (isElement(current) && isSkipped(current, settings)) return true;
    }
    return false;
  }

  function onMutations(records: MutationRecord[]) {
    if (!active || !options) return;
    const settings = options;
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
      if (insideSkipped(target, settings)) continue;

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
        if (isElement(node) && !flowsInline(node, settings)) added.add(node);
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
      if (insideSkipped(element, settings)) continue;
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

  function begin(received: PageTranslationOptions) {
    options = received;
    // A scroll margin widens the viewport and every scrolling box inside the
    // page alike. A root margin on top of it would count twice for the page
    // itself, so it is only the fallback where there is no scroll margin.
    const ahead = Math.round(received.aheadViewports * window.innerHeight);
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
    report();
  }

  return {
    get active() {
      return active;
    },

    start() {
      if (active) return;
      active = true;
      halted = false;
      closedInARow = 0;
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
        if (item.unit.translated) restoreUnit(item.unit);
      }
      tracked.clear();
      byHost.clear();
      queue.clear();
      inFlight.clear();
      owners = new WeakMap();
      visited = new WeakSet();
      nearHosts = new WeakSet();
      rescans = new WeakMap();
      options = undefined;
      waitingForPermit = false;
      pausedUntil = 0;
      report();
    },
  };
}
