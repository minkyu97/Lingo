import type { ProviderId, Settings } from "@lingo/core";

/** What a settings screen needs to know about one provider. */
export interface ProviderChoice {
  label: string;
  defaultModel: string;
  /** The model for translating whole pages when none is chosen. */
  defaultPageModel: string;
  /** Models to offer. Any other model ID can still be typed in. */
  models: readonly { id: string; label: string }[];
  /** Where a user creates an API key. */
  keysUrl: string;
}

/**
 * What became of the key last entered for the selected provider.
 *
 * - `idle`: nothing to report.
 * - `checking`: the provider is being asked whether it accepts the key.
 * - `saved`: the provider accepted the key, and it was stored.
 * - `rejected`: the provider refused the key, so it was not stored.
 * - `unreachable`: the provider could not be asked, so it was not stored.
 */
export type KeyStatus =
  | "idle"
  | "checking"
  | "saved"
  | "rejected"
  | "unreachable";

export interface SettingsPanelProps {
  settings: Settings;
  providers: Readonly<Record<ProviderId, ProviderChoice>>;
  /** The stored API key of each provider that has one. */
  apiKeys: Partial<Record<ProviderId, string>>;
  keyStatus: KeyStatus;
  /** The shortcuts that are set, as the platform writes them. */
  shortcuts: readonly string[];
  version: string;
  sourceUrl: string;
  /** Called with the whole settings each time one of them changes. */
  onSettingsChange: (settings: Settings) => void;
  /**
   * Called with a key to check and store, when the key field is left or
   * Enter is pressed in it. An empty key means: remove the stored one.
   */
  onApiKeySubmit: (provider: ProviderId, key: string) => void;
  onOpenShortcuts: () => void;
  /** Leave out where the panel cannot be closed, such as a page of its own. */
  onClose?: () => void;
  /**
   * The page that the panel is shown in. Leave it out where the panel stands
   * on its own, with no page behind it to translate.
   */
  page?: PageSwitch;
}

/** Whether the page in front is being translated, and how to change that. */
export interface PageSwitch {
  translating: boolean;
  /** Translates the page, or shows its original again. */
  onToggle: () => void;
}

/** The props of a screen that is reached from the main one. */
export type DetailScreenProps = SettingsPanelProps & { onBack: () => void };
