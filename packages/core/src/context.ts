/** How much text around the selection a platform managed to capture. */
export type ContextLevel = "none" | "sentence" | "paragraph" | "document";

/** A selection and whatever surrounding text came with it. */
export interface CapturedContext {
  /** The text the user selected. */
  selection: string;
  level: ContextLevel;
  /** Text immediately before the selection. */
  before?: string;
  /** Text immediately after the selection. */
  after?: string;
  /** Page or window title. */
  title?: string;
  url?: string;
  appName?: string;
}

/** Whether the context carries any text beyond the selection itself. */
export function hasSurroundingText(context: CapturedContext): boolean {
  return Boolean(context.before || context.after);
}

/** Drops everything except the selection. Used when context awareness is off. */
export function withoutContext(context: CapturedContext): CapturedContext {
  return { selection: context.selection, level: "none" };
}

/**
 * Limits the surrounding text to `maxChars`, keeping the text nearest the
 * selection. The budget is split evenly, and a side that needs less than its
 * half gives the remainder to the other side.
 */
export function clampContext(
  context: CapturedContext,
  maxChars: number,
): CapturedContext {
  const before = context.before ?? "";
  const after = context.after ?? "";
  const budget = Math.max(0, Math.floor(maxChars));
  if (before.length + after.length <= budget) return context;

  const half = Math.floor(budget / 2);
  const beforeBudget = Math.max(half, budget - after.length);
  const afterBudget = Math.max(budget - half, budget - before.length);
  const clampedBefore = takeEnd(before, Math.min(before.length, beforeBudget));
  const clampedAfter = takeStart(after, Math.min(after.length, afterBudget));

  const clamped: CapturedContext = {
    ...context,
    before: clampedBefore,
    after: clampedAfter,
  };
  return hasSurroundingText(clamped)
    ? clamped
    : { ...clamped, level: "none", before: undefined, after: undefined };
}

function takeEnd(text: string, count: number): string {
  if (count <= 0) return "";
  let start = text.length - count;
  // Do not start in the middle of a surrogate pair.
  if (isLowSurrogate(text.charCodeAt(start))) start += 1;
  return text.slice(start);
}

function takeStart(text: string, count: number): string {
  if (count <= 0) return "";
  let end = count;
  // Do not end in the middle of a surrogate pair.
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end -= 1;
  return text.slice(0, end);
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
