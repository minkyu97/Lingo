import { describe, expect, it } from "vitest";
import tokens from "../styles/tokens.css?raw";
import { PLACEHOLDER_STEPS, placeholderColor } from "./placeholder.ts";

/** The value of a custom property in `tokens.css`. */
function token(name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1];
}

describe("the text placeholder", () => {
  it("pulses between the two tones of the design tokens", () => {
    expect(placeholderColor(Math.min(...PLACEHOLDER_STEPS))).toBe(
      token("--lingo-placeholder"),
    );
    expect(placeholderColor(Math.max(...PLACEHOLDER_STEPS))).toBe(
      token("--lingo-placeholder-strong"),
    );
  });

  it("starts at rest, and comes back to where it started", () => {
    expect(PLACEHOLDER_STEPS[0]).toBe(Math.min(...PLACEHOLDER_STEPS));
    // Up to the strong tone and back by the same steps.
    const peak = PLACEHOLDER_STEPS.indexOf(Math.max(...PLACEHOLDER_STEPS));
    const up = PLACEHOLDER_STEPS.slice(1, peak);
    const down = PLACEHOLDER_STEPS.slice(peak + 1);
    expect(down).toEqual(up.toReversed());
  });
});
