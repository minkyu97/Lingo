import { PLACEHOLDER_STEP_MS, PLACEHOLDER_STEPS } from "@lingo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlaceholders,
  PLACEHOLDER_CSS,
  type PlaceholderEnv,
} from "./placeholders.ts";

/** Stands in for the browser's highlights: which ranges have which name. */
function fakeBrowser({ still = false } = {}) {
  const registered = new Map<string, Set<AbstractRange>>();
  const adopted = new Map<Node, string[]>();
  const env: PlaceholderEnv = {
    registry: {
      set: (name, ranges) => registered.set(name, ranges as Set<AbstractRange>),
      delete: (name) => registered.delete(name),
    },
    createRangeSet: () => new Set<AbstractRange>(),
    adoptStyles(scope, css) {
      adopted.set(scope, [...(adopted.get(scope) ?? []), css]);
      return () => adopted.delete(scope);
    },
    prefersStillness: () => still,
  };
  /** The step of the pulse that a range is at, or undefined if it is not shown. */
  const stepOf = (range: Range) => {
    for (const [name, ranges] of registered) {
      if (ranges.has(range))
        return Number(name.replace("lingo-placeholder-", ""));
    }
    return undefined;
  };
  return { env, registered, adopted, stepOf };
}

function rangeOver(html: string): Range {
  const paragraph = document.createElement("p");
  paragraph.innerHTML = html;
  document.body.append(paragraph);
  const range = new Range();
  range.selectNodeContents(paragraph);
  return range;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createPlaceholders", () => {
  it("has a rule for every step, which hides the text and paints the bar", () => {
    for (let step = 0; step < PLACEHOLDER_STEPS.length; step++) {
      expect(PLACEHOLDER_CSS).toContain(
        `::highlight(lingo-placeholder-${step})`,
      );
    }
    expect(PLACEHOLDER_CSS).toContain("color: transparent");
    expect(PLACEHOLDER_CSS).toContain("rgb(128 128 128 / 0.14)");
    expect(PLACEHOLDER_CSS).toContain("rgb(128 128 128 / 0.24)");
  });

  it("covers text, and puts its rules in the document once", () => {
    const { env, adopted, stepOf } = fakeBrowser();
    const placeholders = createPlaceholders(env);
    const first = rangeOver("One");
    const second = rangeOver("Two");

    placeholders.show("a", first);
    placeholders.show("b", second);

    expect(stepOf(first)).toBe(0);
    expect(adopted.get(document)).toEqual([PLACEHOLDER_CSS]);
    // The next paragraph is one step behind, so the pulse runs downward.
    expect(stepOf(second)).toBe(PLACEHOLDER_STEPS.length - 1);
  });

  it("moves every bar one step on at each beat, and around again", () => {
    const { env, stepOf } = fakeBrowser();
    const placeholders = createPlaceholders(env);
    const first = rangeOver("One");
    const second = rangeOver("Two");
    placeholders.show("a", first);
    placeholders.show("b", second);

    vi.advanceTimersByTime(PLACEHOLDER_STEP_MS);
    expect(stepOf(first)).toBe(1);
    expect(stepOf(second)).toBe(0);

    vi.advanceTimersByTime(
      PLACEHOLDER_STEP_MS * (PLACEHOLDER_STEPS.length - 1),
    );
    expect(stepOf(first)).toBe(0);
  });

  it("uncovers text, and leaves nothing behind when the last one goes", () => {
    const { env, registered, adopted, stepOf } = fakeBrowser();
    const placeholders = createPlaceholders(env);
    const first = rangeOver("One");
    const second = rangeOver("Two");
    placeholders.show("a", first);
    placeholders.show("b", second);

    placeholders.hide("a");
    expect(stepOf(first)).toBeUndefined();
    expect(stepOf(second)).toBeDefined();

    placeholders.hide("b");
    expect(registered.size).toBe(0);
    expect(adopted.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears everything at once", () => {
    const { env, registered, adopted } = fakeBrowser();
    const placeholders = createPlaceholders(env);
    placeholders.show("a", rangeOver("One"));
    placeholders.show("b", rangeOver("Two"));

    placeholders.clear();

    expect(registered.size).toBe(0);
    expect(adopted.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("puts its rules into a shadow tree that holds waiting text", () => {
    const { env, adopted } = fakeBrowser();
    const placeholders = createPlaceholders(env);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>Inside</p>";
    const range = new Range();
    range.selectNodeContents(shadow.firstChild as Node);

    placeholders.show("a", range);

    expect(adopted.get(shadow)).toEqual([PLACEHOLDER_CSS]);
    expect(adopted.has(document)).toBe(false);
  });

  it("holds still for someone who avoids motion", () => {
    const { env, stepOf } = fakeBrowser({ still: true });
    const placeholders = createPlaceholders(env);
    const first = rangeOver("One");
    const second = rangeOver("Two");
    placeholders.show("a", first);
    placeholders.show("b", second);

    vi.advanceTimersByTime(PLACEHOLDER_STEP_MS * 3);

    expect(stepOf(first)).toBe(0);
    expect(stepOf(second)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing in a browser without highlights", () => {
    const { env, adopted } = fakeBrowser();
    const placeholders = createPlaceholders({ ...env, registry: undefined });
    placeholders.show("a", rangeOver("One"));
    placeholders.hide("a");
    placeholders.clear();
    expect(adopted.size).toBe(0);
  });
});
