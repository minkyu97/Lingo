import { nativeLanguageName } from "@lingo/core";
import { CodeXml, Keyboard, Languages, ScanText, Sparkles } from "lucide-react";
import { PanelHeader } from "./PanelHeader.tsx";
import { SettingsRow } from "./SettingsRow.tsx";
import type { SettingsPanelProps } from "./types.ts";

/** The screens a row of the main screen can lead to. */
export type DetailScreen = "engine" | "language" | "context";

/** The list of settings, each with its current value. */
export function MainScreen({
  settings,
  providers,
  apiKeys,
  shortcut,
  version,
  sourceUrl,
  onOpenShortcuts,
  onClose,
  onOpen,
}: SettingsPanelProps & { onOpen: (screen: DetailScreen) => void }) {
  const provider = providers[settings.provider];
  const model = settings.models[settings.provider] ?? provider.defaultModel;
  // A model ID that was typed in by hand has no label, so it shows as it is.
  const modelLabel =
    provider.models.find(({ id }) => id === model)?.label ?? model;
  const hasKey = apiKeys[settings.provider] !== undefined;
  const context = settings.contextAwareness
    ? `On · ${settings.maxContextChars.toLocaleString("en-US")} chars`
    : "Off";

  return (
    <>
      <PanelHeader title="Settings" onClose={onClose} />
      <div className="lingo-settings__content">
        <SettingsRow
          icon={Sparkles}
          label="Translation engine"
          value={hasKey ? modelLabel : "Not set"}
          warning={!hasKey}
          onClick={() => onOpen("engine")}
        />
        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Lookup</h2>
        <SettingsRow
          icon={ScanText}
          label="Context"
          value={context}
          onClick={() => onOpen("context")}
        />
        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">General</h2>
        <SettingsRow
          icon={Languages}
          label="Translate into"
          value={nativeLanguageName(settings.targetLanguage)}
          onClick={() => onOpen("language")}
        />
        <SettingsRow
          icon={Keyboard}
          label="Keyboard shortcut"
          value={shortcut || "Not set"}
          external
          onClick={onOpenShortcuts}
        />
        <hr className="lingo-divider" />
        <SettingsRow
          icon={CodeXml}
          label="Source code"
          external
          href={sourceUrl}
        />
      </div>
      <p className="lingo-settings__footer">Lingo {version}</p>
    </>
  );
}
