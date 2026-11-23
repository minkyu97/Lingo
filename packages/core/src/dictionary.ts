import { z } from "zod";
import { parsePartialJson } from "./partial-json.ts";

/**
 * A text field of an entry. It reads as empty until it has arrived, and when
 * the model sent something that is not text.
 */
const textField = z.string().catch("");

/**
 * One meaning of a term. The shape matches
 * `spec/dictionary-entry.schema.json`, where an absent value is an empty
 * string rather than a missing field.
 */
const senseSchema = z.object({
  /** The part of speech, named in the reader's language. */
  partOfSpeech: textField,
  /** A short equivalent or definition in the reader's language. */
  meaning: textField,
  /** Whether this is the sense the term has in the captured passage. */
  inContext: z.boolean().catch(false),
  /** A short example in the term's own language. */
  example: textField,
  /** The example in the reader's language. */
  exampleTranslation: textField,
});

/** A dictionary entry for a looked-up term. */
const entrySchema = z.object({
  /** The dictionary form of the term, in the term's own language. */
  headword: textField,
  /** IPA, or a reading such as kana or pinyin. */
  pronunciation: textField,
  /** What the term means in the captured passage. Empty without a passage. */
  contextMeaning: textField,
  // A member that is not an object is dropped. The others are kept.
  senses: z
    .array(senseSchema.nullable().catch(null))
    .catch([])
    .transform((senses) => senses.filter((sense) => sense !== null)),
});

export type DictionarySense = z.infer<typeof senseSchema>;
export type DictionaryEntry = z.infer<typeof entrySchema>;

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
  const parsed = entrySchema.safeParse(parsePartialJson(text));
  return parsed.success ? parsed.data : undefined;
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
 * Groups senses by part of speech, the way a dictionary lists them: one group
 * per part of speech, in the order each first appears. Senses whose meaning
 * has not arrived yet are left out.
 */
export function groupSenses(senses: readonly DictionarySense[]): SenseGroup[] {
  const groups: SenseGroup[] = [];
  for (const sense of senses) {
    if (!sense.meaning) continue;
    const group = groups.find(
      ({ partOfSpeech }) => partOfSpeech === sense.partOfSpeech,
    );
    if (group) {
      group.senses.push(sense);
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
