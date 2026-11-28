import type { Engine, ModelInfo, ProviderId, Settings } from "@lingo/core";

/** What a settings screen needs to know about one provider. */
export interface ProviderChoice {
  label: string;
  /** Where a user creates an API key. */
  keysUrl: string;
}

/**
 * What a provider said about an API key, and the models the key can use.
 *
 * - `accepted`: the provider accepted the key.
 * - `rejected`: the provider refused the key.
 * - `unreachable`: the provider could not be asked.
 */
export interface KeyCheck {
  status: "accepted" | "rejected" | "unreachable";
  /** Newest first. Empty unless the key was accepted. */
  models: ModelInfo[];
}

export interface SettingsPanelProps {
  settings: Settings;
  providers: Readonly<Record<ProviderId, ProviderChoice>>;
  /** The stored API key of each engine that has one, by engine ID. */
  engineKeys: Readonly<Record<string, string>>;
  /** The shortcuts that are set, as the platform writes them. */
  shortcuts: readonly string[];
  version: string;
  sourceUrl: string;
  /** Called with the whole settings each time one of them changes. */
  onSettingsChange: (settings: Settings) => void;
  /** Asks a provider about a key. It lists the models the key can use. */
  onCheckKey: (provider: ProviderId, key: string) => Promise<KeyCheck>;
  /**
   * Called with an engine to add, or to store in place of the one with the
   * same ID, and with its API key.
   */
  onEngineSave: (engine: Engine, key: string) => void;
  onEngineRemove: (engineId: string) => void;
  onOpenShortcuts: () => void;
  cache: CacheStore;
  /** Leave out where the panel cannot be closed, such as a page of its own. */
  onClose?: () => void;
  /**
   * The page that the panel is shown in. Leave it out where the panel stands
   * on its own, with no page behind it to translate.
   */
  page?: PageSwitch;
}

/** What the cache holds. */
export interface CacheUsage {
  /** How many answers are stored. */
  entries: number;
  /** How much room they take, in bytes. */
  bytes: number;
  /** How much room the cache may take, in bytes. */
  maxBytes: number;
}

/** The stored answers, as the settings show and change them. */
export interface CacheStore {
  /** Left out until it is known. */
  usage?: CacheUsage;
  /** Asks for `usage` to be worked out again. */
  onRefresh: () => void;
  /** Removes every stored answer. */
  onClear: () => void;
}

/** Whether the page in front is being translated, and how to change that. */
export interface PageSwitch {
  translating: boolean;
  /** Translates the page, or shows its original again. */
  onToggle: () => void;
}

/** The props of a screen that is reached from another one. */
export type DetailScreenProps = SettingsPanelProps & { onBack: () => void };
