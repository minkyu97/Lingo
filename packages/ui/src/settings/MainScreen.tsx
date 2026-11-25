import { nativeLanguageName } from "@lingo/core";
import {
  CodeXml,
  FileText,
  Gauge,
  Keyboard,
  Languages,
  ScanText,
  Sparkles,
} from "lucide-react";
import { ActionRow } from "./ActionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { SettingsRow } from "./SettingsRow.tsx";
import type { SettingsPanelProps } from "./types.ts";

/** The screens a row of the main screen can lead to. */
export type DetailScreen =
  | "engine"
  | "language"
  | "context"
  | "pageModel"
  | "requestRate";

/** The list of settings, each with its current value. */
export function MainScreen({
  settings,
  providers,
  apiKeys,
  shortcuts,
  version,
  sourceUrl,
  page,
  onOpenShortcuts,
  onClose,
  onOpen,
}: SettingsPanelProps & { onOpen: (screen: DetailScreen) => void }) {
  const provider = providers[settings.provider];
  const model = settings.models[settings.provider] ?? provider.defaultModel;
  // A model ID that was typed in by hand has no label, so it shows as it is.
  const modelLabel =
    provider.models.find(({ id }) => id === model)?.label ?? model;
  const pageModel =
    settings.pageModels[settings.provider] ?? provider.defaultPageModel;
  const pageModelLabel =
    provider.models.find(({ id }) => id === pageModel)?.label ?? pageModel;
  const hasKey = apiKeys[settings.provider] !== undefined;
  const context = settings.contextAwareness
    ? `On · ${settings.maxContextChars.toLocaleString("en-US")} chars`
    : "Off";

  return (
    <>
      <PanelHeader title="Settings" onClose={onClose} />
      <div className="lingo-settings__content">
        {page && (
          <>
            <ActionRow
              icon={FileText}
              label={
                page.translating
                  ? `Translating into ${nativeLanguageName(settings.targetLanguage)}`
                  : "Translate this page"
              }
              action={page.translating ? "Show original" : "Translate"}
              emphasis={page.translating ? "secondary" : "primary"}
              onAction={page.onToggle}
            />
            <hr className="lingo-divider" />
          </>
        )}
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
        <h2 className="lingo-group-label">Pages</h2>
        <SettingsRow
          icon={Sparkles}
          label="Model"
          value={pageModelLabel}
          onClick={() => onOpen("pageModel")}
        />
        <SettingsRow
          icon={Gauge}
          label="Request rate"
          value={`${settings.pageRequestsPerSecond} per second`}
          onClick={() => onOpen("requestRate")}
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
          label="Keyboard shortcuts"
          value={shortcuts.join(" · ") || "Not set"}
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
