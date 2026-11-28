import {
  type Engine,
  removeEngine,
  type Settings,
  saveEngine,
} from "@lingo/core";
import { PROVIDERS } from "@lingo/providers/catalog";
import { type PageSwitch, SettingsPanel } from "@lingo/ui";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { requestKeyCheck } from "../key-check.ts";
import {
  isRuntimeMessage,
  LOOKUP_COMMAND,
  type PageSwitchAction,
  type PageSwitchAnswer,
  pageSwitchAnswerSchema,
  type RuntimeMessage,
} from "../messaging.ts";
import { PAGE_TRANSLATION_COMMAND } from "../page-translation/protocol.ts";
import {
  type EngineKeys,
  loadEngineKeys,
  loadSettings,
  saveEngineKey,
  saveSettings,
} from "../stores.ts";

const SOURCE_URL = "https://github.com/minkyu97/Lingo";

/** Where Chrome lets the user change an extension's shortcuts. */
const SHORTCUTS_URL = "chrome://extensions/shortcuts";

export interface SettingsAppProps {
  /** Given where the settings can be closed, such as the in-page panel. */
  onClose?: () => void;
  /** Whether the settings are shown inside a page, which they can translate. */
  inPage?: boolean;
}

function askPageSwitch(action: PageSwitchAction): Promise<PageSwitchAnswer> {
  const message: RuntimeMessage = { type: "page-translation", action };
  return browser.runtime
    .sendMessage(message)
    .catch(() => undefined)
    .then((answer) => pageSwitchAnswerSchema.parse(answer));
}

/**
 * Whether the page around the settings is being translated, and a way to
 * change that. It follows changes made elsewhere, such as by the shortcut.
 */
function usePageSwitch(inPage: boolean): PageSwitch | undefined {
  const [translating, setTranslating] = useState(false);
  const tabId = useRef<number>(undefined);

  useEffect(() => {
    if (!inPage) return;
    void askPageSwitch("query").then((answer) => {
      tabId.current = answer.tabId;
      setTranslating(answer.on);
    });
    const onMessage = (message: unknown) => {
      if (!isRuntimeMessage(message)) return;
      if (message.type !== "page-translation-changed") return;
      if (message.tabId === tabId.current) setTranslating(message.on);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [inPage]);

  if (!inPage) return undefined;
  return {
    translating,
    onToggle: () =>
      void askPageSwitch("toggle").then(({ on }) => setTranslating(on)),
  };
}

/**
 * The settings panel connected to the extension: it shows what is in storage
 * and stores each change as it is made. An engine's API key is stored once
 * its provider has accepted it. It runs only in the extension's own
 * pages, never in a content script, because it reads the API keys.
 */
export function SettingsApp({ onClose, inPage = false }: SettingsAppProps) {
  const page = usePageSwitch(inPage);
  const [settings, setSettings] = useState<Settings>();
  const [engineKeys, setEngineKeys] = useState<EngineKeys>({});
  const [shortcuts, setShortcuts] = useState<string[]>([]);

  useEffect(() => {
    // The settings first: reading them is what turns old keys into engine keys.
    void loadSettings().then(async (loaded) => {
      setEngineKeys(await loadEngineKeys());
      setSettings(loaded);
    });
    void browser.commands.getAll().then((commands) => {
      // Lookup first, then page translation, leaving out what is not set.
      const set = [LOOKUP_COMMAND, PAGE_TRANSLATION_COMMAND]
        .map((name) => commands.find((command) => command.name === name))
        .flatMap((command) => command?.shortcut || []);
      setShortcuts(set);
    });
  }, []);

  if (!settings) return null;

  const changeSettings = (next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  };

  /** Stores an engine and its key. The form checked the key before this. */
  const storeEngine = (engine: Engine, key: string) => {
    changeSettings(saveEngine(settings, engine));
    setEngineKeys((keys) => ({ ...keys, [engine.id]: key }));
    void saveEngineKey(engine.id, key).then(() => {
      // A page translation that stopped for want of a key can go on now.
      if (inPage) void askPageSwitch("retry");
    });
  };

  const discardEngine = (engineId: string) => {
    changeSettings(removeEngine(settings, engineId));
    setEngineKeys(({ [engineId]: _gone, ...keys }) => keys);
    void saveEngineKey(engineId, undefined);
  };

  return (
    <SettingsPanel
      settings={settings}
      providers={PROVIDERS}
      engineKeys={engineKeys}
      shortcuts={shortcuts}
      version={browser.runtime.getManifest().version}
      sourceUrl={SOURCE_URL}
      onSettingsChange={changeSettings}
      onCheckKey={requestKeyCheck}
      onEngineSave={storeEngine}
      onEngineRemove={discardEngine}
      onOpenShortcuts={() => void browser.tabs.create({ url: SHORTCUTS_URL })}
      onClose={onClose}
      page={page}
    />
  );
}
