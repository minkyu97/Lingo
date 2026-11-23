import type { LookupMode } from "./prompt.ts";

/** Selections with at most this many words are looked up like a dictionary entry. */
const MAX_DEFINE_WORDS = 3;

const SENTENCE_PUNCTUATION = /[.!?。！？…]/;

/**
 * Picks the default mode for a selection: a word or short phrase is defined,
 * anything longer is translated. The user can always switch.
 */
export function chooseMode(selection: string): LookupMode {
  const text = selection.trim();
  if (text === "" || text.includes("\n") || SENTENCE_PUNCTUATION.test(text)) {
    return "translate";
  }
  return countWords(text) <= MAX_DEFINE_WORDS ? "define" : "translate";
}

/** Counts words in any script, including ones written without spaces. */
function countWords(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) count += 1;
  }
  return count;
}
