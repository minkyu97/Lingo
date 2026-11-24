import type { ProviderId, Settings } from "@lingo/core";
import { PROVIDERS } from "@lingo/providers/catalog";
import { type KeyStatus, SettingsPanel } from "@lingo/ui";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { requestKeyCheck } from "../key-check.ts";
import { LOOKUP_COMMAND } from "../messaging.ts";
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
}

/**
 * The settings panel connected to the extension: it shows what is in storage
 * and stores each change as it is made, except that an API key is stored only
 * after its provider has accepted it. It runs only in the extension's own
 * pages, never in a content script, because it reads the API keys.
 */
export function SettingsApp({ onClose }: SettingsAppProps) {
  const [settings, setSettings] = useState<Settings>();
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [shortcut, setShortcut] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
  const savedNotice = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Counts key submissions, so that only the latest one reports back. */
  const submission = useRef(0);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadApiKeys().then(setApiKeys);
    void browser.commands.getAll().then((commands) => {
      const lookup = commands.find(({ name }) => name === LOOKUP_COMMAND);
      setShortcut(lookup?.shortcut ?? "");
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
    if (result === "accepted") await storeApiKey(provider, key);
    report(result === "accepted" ? "saved" : result);
  }

  return (
    <SettingsPanel
      settings={settings}
      providers={PROVIDERS}
      apiKeys={apiKeys}
      keyStatus={keyStatus}
      shortcut={shortcut}
      version={browser.runtime.getManifest().version}
      sourceUrl={SOURCE_URL}
      onSettingsChange={changeSettings}
      onApiKeySubmit={(provider, key) => void submitApiKey(provider, key)}
      onOpenShortcuts={() => void browser.tabs.create({ url: SHORTCUTS_URL })}
      onClose={onClose}
    />
  );
}
