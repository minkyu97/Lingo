import type { ProviderId, Settings } from "@lingo/core";
import { PROVIDERS } from "@lingo/providers/catalog";
import { type KeyStatus, type PageSwitch, SettingsPanel } from "@lingo/ui";
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
  type ApiKeys,
  loadApiKeys,
  loadSettings,
  saveApiKeys,
  saveSettings,
} from "../stores.ts";

const SOURCE_URL = "https://github.com/minkyu97/Lingo";

/** Where Chrome lets the user change an extension's shortcuts. */
const SHORTCUTS_URL = "chrome://extensions/shortcuts";

/** How long the panel keeps saying that a key was saved. */
const SAVED_NOTICE_MS = 4000;

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
 * and stores each change as it is made, except that an API key is stored only
 * after its provider has accepted it. It runs only in the extension's own
 * pages, never in a content script, because it reads the API keys.
 */
export function SettingsApp({ onClose, inPage = false }: SettingsAppProps) {
  const page = usePageSwitch(inPage);
  const [settings, setSettings] = useState<Settings>();
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
  const savedNotice = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Counts key submissions, so that only the latest one reports back. */
  const submission = useRef(0);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadApiKeys().then(setApiKeys);
    void browser.commands.getAll().then((commands) => {
      // Lookup first, then page translation, leaving out what is not set.
      const set = [LOOKUP_COMMAND, PAGE_TRANSLATION_COMMAND]
        .map((name) => commands.find((command) => command.name === name))
        .flatMap((command) => command?.shortcut || []);
      setShortcuts(set);
    });
    return () => clearTimeout(savedNotice.current);
  }, []);

  if (!settings) return null;

  const changeSettings = (next: Settings) => {
    // What is said about one provider's key does not apply to another's.
    if (next.provider !== settings.provider) {
      submission.current += 1;
      showKeyStatus("idle");
    }
    setSettings(next);
    void saveSettings(next);
  };

  function showKeyStatus(status: KeyStatus) {
    clearTimeout(savedNotice.current);
    setKeyStatus(status);
    if (status === "saved") {
      savedNotice.current = setTimeout(
        () => setKeyStatus("idle"),
        SAVED_NOTICE_MS,
      );
    }
  }

  async function storeApiKey(provider: ProviderId, key: string) {
    await saveApiKeys({ ...(await loadApiKeys()), [provider]: key });
    setApiKeys(await loadApiKeys());
  }

  /**
   * A key is stored only once its provider has accepted it. An empty key
   * removes the stored one, which needs no check.
   */
  async function submitApiKey(provider: ProviderId, key: string) {
    submission.current += 1;
    const id = submission.current;
    const report = (status: KeyStatus) => {
      if (id === submission.current) showKeyStatus(status);
    };

    if (!key) {
      await storeApiKey(provider, "");
      report("idle");
      return;
    }
    report("checking");
    const result = await requestKeyCheck(provider, key);
    if (result === "accepted") {
      await storeApiKey(provider, key);
      // A page translation that stopped for want of a key can go on now.
      if (inPage) void askPageSwitch("retry");
    }
    report(result === "accepted" ? "saved" : result);
  }

  return (
    <SettingsPanel
      settings={settings}
      providers={PROVIDERS}
      apiKeys={apiKeys}
      keyStatus={keyStatus}
      shortcuts={shortcuts}
      version={browser.runtime.getManifest().version}
      sourceUrl={SOURCE_URL}
      onSettingsChange={changeSettings}
      onApiKeySubmit={(provider, key) => void submitApiKey(provider, key)}
      onOpenShortcuts={() => void browser.tabs.create({ url: SHORTCUTS_URL })}
      onClose={onClose}
      page={page}
    />
  );
}
