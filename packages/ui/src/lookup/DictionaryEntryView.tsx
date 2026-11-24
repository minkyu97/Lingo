import { type DictionaryEntry, groupSenses } from "@lingo/core";
import { Badge } from "../controls/Badge.tsx";
import { Callout } from "../controls/Callout.tsx";

export interface DictionaryEntryViewProps {
  /** The entry so far. Fields that have not arrived yet are empty. */
  entry: DictionaryEntry;
  /** Whether more of the entry is still on its way. */
  streaming?: boolean;
}

/**
 * Lays out a definition like a dictionary entry: headword and pronunciation,
 * the meaning in the passage it was found in, then the senses under their
 * parts of speech. It draws whatever has arrived, so it can be shown while
 * the entry streams in.
 */
export function DictionaryEntryView({
  entry,
  streaming = false,
}: DictionaryEntryViewProps) {
  const groups = groupSenses(entry.senses);

  return (
    <div className="lingo-entry" data-streaming={streaming}>
      {(entry.headword || entry.pronunciation) && (
        <p className="lingo-entry__heading">
          <span className="lingo-entry__headword">{entry.headword}</span>
          {entry.pronunciation && (
            <span className="lingo-entry__pronunciation">
              {entry.pronunciation}
            </span>
          )}
        </p>
      )}

      {entry.contextMeaning && (
        <Callout label="In this context">{entry.contextMeaning}</Callout>
      )}

      {groups.map((group) => (
        <section key={group.partOfSpeech} className="lingo-entry__group">
          {group.partOfSpeech && (
            <h3 className="lingo-entry__part-of-speech">
              {group.partOfSpeech}
            </h3>
          )}
          <ol className="lingo-entry__senses">
            {group.senses.map((sense, index) => (
              <li
                // Senses are only ever appended, so a position identifies one.
                key={index}
                className="lingo-entry__sense"
                data-in-context={sense.inContext}
              >
                <p className="lingo-entry__meaning">
                  <span>{sense.meaning}</span>
                  {sense.inContext && <Badge>in context</Badge>}
                </p>
                {sense.example && (
                  <p className="lingo-entry__example">{sense.example}</p>
                )}
                {sense.exampleTranslation && (
                  <p className="lingo-entry__translation">
                    {sense.exampleTranslation}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
