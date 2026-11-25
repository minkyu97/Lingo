/**
 * The text placeholder of the design file: mid gray bars that stand in for
 * the lines of a paragraph while it is being translated, and pulse slowly.
 *
 * The bars are painted on text of the page itself, outside any Lingo
 * component, so these values are plain numbers and not custom properties.
 * `--lingo-placeholder` and `--lingo-placeholder-strong` in `tokens.css`
 * carry the two ends of the pulse under their design names.
 */

/** How opaque the gray is at each step of one pulse: up and back down. */
export const PLACEHOLDER_STEPS: readonly number[] = [
  0.14, 0.17, 0.21, 0.24, 0.21, 0.17,
];

/** How long each step lasts. One pulse takes about a second. */
export const PLACEHOLDER_STEP_MS = 170;

/** The color of a bar at the given opacity. It reads on light and dark pages. */
export function placeholderColor(opacity: number): string {
  return `rgb(128 128 128 / ${opacity})`;
}
