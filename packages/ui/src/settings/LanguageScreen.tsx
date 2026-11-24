import {
  languageName,
  nativeLanguageName,
  TARGET_LANGUAGES,
} from "@lingo/core";
import { useState } from "react";
import { SearchField } from "../controls/SearchField.tsx";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { DetailScreenProps } from "./types.ts";

/** The language that translations and definitions are written in. */
export function LanguageScreen({
  settings,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps) {
  const [query, setQuery] = useState("");

  // A stored language that is not on the list stays available.
  const tags = TARGET_LANGUAGES.includes(settings.targetLanguage)
    ? TARGET_LANGUAGES
    : [settings.targetLanguage, ...TARGET_LANGUAGES];
  const sought = query.trim().toLocaleLowerCase();
  const languages = tags
    .map((tag) => ({
      tag,
      name: nativeLanguageName(tag),
      english: languageName(tag),
    }))
    .filter(({ tag, name, english }) =>
      [tag, name, english].some((text) =>
        text.toLocaleLowerCase().includes(sought),
      ),
    );

  return (
    <>
      <PanelHeader title="Translate into" onBack={onBack} onClose={onClose} />
      <div className="lingo-settings__content">
        <div className="lingo-settings__field">
          <SearchField
            label="Search languages"
            value={query}
            onChange={setQuery}
          />
        </div>
        <div role="radiogroup" aria-label="Translate into">
          {languages.map(({ tag, name, english }) => (
            <OptionRow
              key={tag}
              name="language"
              label={name}
              description={english === name ? undefined : english}
              checked={tag === settings.targetLanguage}
              onSelect={() =>
                onSettingsChange({ ...settings, targetLanguage: tag })
              }
            />
          ))}
        </div>
        {languages.length === 0 && (
          <p className="lingo-settings__note">No language matches.</p>
        )}
      </div>
    </>
  );
}
