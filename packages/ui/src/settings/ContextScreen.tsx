import { CONTEXT_CHAR_PRESETS, defaultSettings } from "@lingo/core";
import { useId } from "react";
import { Switch } from "../controls/Switch.tsx";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { DetailScreenProps } from "./types.ts";

const DEFAULT_CONTEXT_CHARS = defaultSettings().maxContextChars;

/** Whether the text around a selection is sent, and how much of it. */
export function ContextScreen({
  settings,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps) {
  const switchLabel = useId();

  return (
    <>
      <PanelHeader title="Context" onBack={onBack} onClose={onClose} />
      <div className="lingo-settings__content">
        <div className="lingo-switch-row">
          <span id={switchLabel}>Send the text around my selection</span>
          <Switch
            aria-labelledby={switchLabel}
            checked={settings.contextAwareness}
            onChange={(contextAwareness) =>
              onSettingsChange({ ...settings, contextAwareness })
            }
          />
        </div>
        <p className="lingo-settings__note">
          With context, a word is explained by what it means in its sentence.
          This sends more than you selected: the surrounding paragraph and the
          page title. Each answer shows what was sent.
        </p>

        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Longest context</h2>
        <div role="radiogroup" aria-label="Longest context">
          {CONTEXT_CHAR_PRESETS.map((chars) => (
            <OptionRow
              key={chars}
              name="max-context"
              label={`${chars.toLocaleString("en-US")} characters`}
              description={
                chars === DEFAULT_CONTEXT_CHARS ? "Default" : undefined
              }
              checked={chars === settings.maxContextChars}
              // The length only matters while context is being sent.
              disabled={!settings.contextAwareness}
              onSelect={() =>
                onSettingsChange({ ...settings, maxContextChars: chars })
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
