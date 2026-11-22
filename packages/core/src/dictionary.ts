import { parsePartialJson } from "./partial-json.ts";

/**
 * One meaning of a term. The shape matches
 * `spec/dictionary-entry.schema.json`, where an absent value is an empty
 * string rather than a missing field.
 */
export interface DictionarySense {
  /** The part of speech, named in the reader's language. */
  partOfSpeech: string;
  /** A short equivalent or definition in the reader's language. */
  meaning: string;
  /** Whether this is the sense the term has in the captured passage. */
  inContext: boolean;
  /** A short example in the term's own language. */
  example: string;
  /** The example in the reader's language. */
  exampleTranslation: string;
}

/** A dictionary entry for a looked-up term. */
export interface DictionaryEntry {
  /** The dictionary form of the term, in the term's own language. */
  headword: string;
  /** IPA, or a reading such as kana or pinyin. */
  pronunciation: string;
  /** What the term means in the captured passage. Empty without a passage. */
  contextMeaning: string;
  senses: DictionarySense[];
}

/**
 * Reads a dictionary entry from a model's JSON answer. The text may be
 * incomplete: while the answer is still streaming this returns the fields
 * that have arrived, with the rest empty.
 *
 * Returns `undefined` when the text holds no JSON object, which is how a
 * model that ignored the requested format shows up.
 */
export function parseDictionaryEntry(
  text: string,
): DictionaryEntry | undefined {
  const value = parsePartialJson(text);
  if (!isRecord(value)) return undefined;

  const senses = Array.isArray(value.senses) ? value.senses : [];
  return {
    headword: string(value.headword),
    pronunciation: string(value.pronunciation),
    contextMeaning: string(value.contextMeaning),
    senses: senses.filter(isRecord).map((sense) => ({
      partOfSpeech: string(sense.partOfSpeech),
      meaning: string(sense.meaning),
      inContext: sense.inContext === true,
      example: string(sense.example),
      exampleTranslation: string(sense.exampleTranslation),
    })),
  };
}

/** Whether the entry has anything to show yet. */
export function hasDictionaryContent(entry: DictionaryEntry): boolean {
  return Boolean(
    entry.headword ||
      entry.contextMeaning ||
      entry.senses.some((sense) => sense.meaning),
  );
}

export interface SenseGroup {
  partOfSpeech: string;
  senses: DictionarySense[];
}

/**
 * Groups consecutive senses that share a part of speech, the way a dictionary
 * lists them. Senses whose meaning has not arrived yet are left out.
 */
export function groupSenses(senses: readonly DictionarySense[]): SenseGroup[] {
  const groups: SenseGroup[] = [];
  for (const sense of senses) {
    if (!sense.meaning) continue;
    const last = groups.at(-1);
    if (last && last.partOfSpeech === sense.partOfSpeech) {
      last.senses.push(sense);
    } else {
      groups.push({ partOfSpeech: sense.partOfSpeech, senses: [sense] });
    }
  }
  return groups;
}

/** Renders an entry as plain text, for copying. */
export function dictionaryEntryToText(entry: DictionaryEntry): string {
  const lines: string[] = [];
  const heading = [entry.headword, entry.pronunciation]
    .filter(Boolean)
    .join(" ");
  if (heading) lines.push(heading);
  if (entry.contextMeaning) {
    lines.push(`In this context: ${entry.contextMeaning}`);
  }

  for (const group of groupSenses(entry.senses)) {
    lines.push("");
    if (group.partOfSpeech) lines.push(group.partOfSpeech);
    group.senses.forEach((sense, index) => {
      lines.push(`${index + 1}. ${sense.meaning}`);
      const example = [sense.example, sense.exampleTranslation]
        .filter(Boolean)
        .join(" / ");
      if (example) lines.push(`   ${example}`);
    });
  }
  return lines.join("\n").trim();
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
