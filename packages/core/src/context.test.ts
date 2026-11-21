import { describe, expect, it } from "vitest";
import {
  type CapturedContext,
  clampContext,
  hasSurroundingText,
  withoutContext,
} from "./context.ts";

const paragraph: CapturedContext = {
  selection: "bank",
  level: "paragraph",
  before: "She sat on the river ",
  after: " and watched the boats.",
  title: "A walk",
  url: "https://example.com/walk",
};

describe("hasSurroundingText", () => {
  it("is true when either side has text", () => {
    expect(hasSurroundingText(paragraph)).toBe(true);
    expect(
      hasSurroundingText({ selection: "x", level: "sentence", after: "y" }),
    ).toBe(true);
  });

  it("is false for a bare selection", () => {
    expect(hasSurroundingText({ selection: "x", level: "none" })).toBe(false);
    expect(
      hasSurroundingText({ selection: "x", level: "none", before: "" }),
    ).toBe(false);
  });
});

describe("withoutContext", () => {
  it("keeps only the selection", () => {
    expect(withoutContext(paragraph)).toEqual({
      selection: "bank",
      level: "none",
    });
  });
});

describe("clampContext", () => {
  it("returns the context unchanged when it fits", () => {
    expect(clampContext(paragraph, 1000)).toBe(paragraph);
  });

  it("keeps the text nearest the selection on both sides", () => {
    const clamped = clampContext(paragraph, 10);
    expect(clamped.before).toBe("iver ");
    expect(clamped.after).toBe(" and ");
    expect(clamped.selection).toBe("bank");
    expect(clamped.level).toBe("paragraph");
  });

  it("gives a short side's unused budget to the other side", () => {
    const context: CapturedContext = {
      selection: "x",
      level: "paragraph",
      before: "ab",
      after: "0123456789",
    };
    const clamped = clampContext(context, 8);
    expect(clamped.before).toBe("ab");
    expect(clamped.after).toBe("012345");
  });

  it("never exceeds the budget", () => {
    for (const max of [0, 1, 2, 3, 7, 20]) {
      const clamped = clampContext(paragraph, max);
      const used = (clamped.before ?? "").length + (clamped.after ?? "").length;
      expect(used).toBeLessThanOrEqual(max);
    }
  });

  it("downgrades to no context when the budget is zero", () => {
    const clamped = clampContext(paragraph, 0);
    expect(clamped.level).toBe("none");
    expect(clamped.before).toBeUndefined();
    expect(clamped.after).toBeUndefined();
    expect(clamped.title).toBe("A walk");
  });

  it("does not split a surrogate pair", () => {
    const context: CapturedContext = {
      selection: "x",
      level: "paragraph",
      before: "ab😀",
      after: "😀cd",
    };
    // One code unit per side cannot hold half of an emoji, so nothing is kept.
    const clamped = clampContext(context, 2);
    expect(clamped.before).toBeUndefined();
    expect(clamped.after).toBeUndefined();
    expect(clamped.level).toBe("none");

    const wider = clampContext(context, 4);
    expect(wider.before).toBe("😀");
    expect(wider.after).toBe("😀");
  });
});
