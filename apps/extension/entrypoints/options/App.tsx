import {
  languageName,
  MAX_CONTEXT_CHARS_LIMIT,
  PROVIDER_IDS,
  type Settings,
  TARGET_LANGUAGES,
} from "@lingo/core";
import { PROVIDERS } from "@lingo/providers/catalog";
import { type FormEvent, useEffect, useState } from "react";
import {
  type ApiKeys,
  loadApiKeys,
  loadSettings,
  saveApiKeys,
  saveSettings,
} from "../../src/stores.ts";

/** Value of the model menu entry that reveals the free-text field. */
const CUSTOM_MODEL = "__custom__";

/** A language's name in that language, with its English name alongside. */
function languageLabel(tag: string): string {
  const english = languageName(tag);
  try {
    const native = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    return native && native !== english ? `${native} (${english})` : english;
  } catch {
    return english;
  }
}

export function OptionsApp() {
  const [settings, setSettings] = useState<Settings>();
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([loadSettings(), loadApiKeys()]).then(([s, keys]) => {
      setSettings(s);
      setApiKeys(keys);
    });
  }, []);

  if (!settings) return null;

  const provider = settings.provider;
  const info = PROVIDERS[provider];
  const model = settings.models[provider] ?? info.defaultModel;
  const isCustomModel = !info.models.some(({ id }) => id === model);
  const languages = TARGET_LANGUAGES.includes(settings.targetLanguage)
    ? TARGET_LANGUAGES
    : [settings.targetLanguage, ...TARGET_LANGUAGES];

  const update = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch });
    setSaved(false);
  };
  const setModel = (value: string) =>
    update({ models: { ...settings.models, [provider]: value } });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    await Promise.all([saveSettings(settings), saveApiKeys(apiKeys)]);
    setSaved(true);
  }

  return (
    <main>
      <h1>Lingo settings</h1>
      <form onSubmit={save}>
        <fieldset>
          <legend>Provider</legend>
          <p className="hint">
            Lingo sends your text straight from this browser to the provider you
            choose, using your own API key.
          </p>
          <div className="choices">
            {PROVIDER_IDS.map((id) => (
              <label key={id}>
                <input
                  type="radio"
                  name="provider"
                  value={id}
                  checked={provider === id}
                  onChange={() => update({ provider: id })}
                />
                {PROVIDERS[id].label}
              </label>
            ))}
          </div>

          <label className="field">
            <span>{info.label} API key</span>
            <input
              type="password"
              name="apiKey"
              autoComplete="off"
              spellCheck={false}
              value={apiKeys[provider] ?? ""}
              onChange={(event) => {
                setApiKeys({ ...apiKeys, [provider]: event.target.value });
                setSaved(false);
              }}
            />
          </label>
          <p className="hint">
            The key is stored only in this browser.{" "}
            <a href={info.keysUrl} target="_blank" rel="noreferrer">
              Create a key
            </a>
          </p>

          <label className="field">
            <span>Model</span>
            <select
              name="model"
              value={isCustomModel ? CUSTOM_MODEL : model}
              onChange={(event) =>
                setModel(
                  event.target.value === CUSTOM_MODEL ? "" : event.target.value,
                )
              }
            >
              {info.models.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Other…</option>
            </select>
          </label>
          {isCustomModel && (
            <label className="field">
              <span>Model ID</span>
              <input
                type="text"
                name="customModel"
                spellCheck={false}
                placeholder={info.defaultModel}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>Translation</legend>
          <label className="field">
            <span>Translate into</span>
            <select
              name="targetLanguage"
              value={settings.targetLanguage}
              onChange={(event) =>
                update({ targetLanguage: event.target.value })
              }
            >
              {languages.map((tag) => (
                <option key={tag} value={tag}>
                  {languageLabel(tag)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Context</legend>
          <label className="check">
            <input
              type="checkbox"
              name="contextAwareness"
              checked={settings.contextAwareness}
              onChange={(event) =>
                update({ contextAwareness: event.target.checked })
              }
            />
            Send the text around my selection
          </label>
          <p className="hint">
            With context, a word is explained by what it means in its sentence.
            This sends more than you selected: the surrounding paragraph and the
            page title. Each answer shows what was sent.
          </p>
          <label className="field">
            <span>Longest context, in characters</span>
            <input
              type="number"
              name="maxContextChars"
              min={0}
              max={MAX_CONTEXT_CHARS_LIMIT}
              step={100}
              disabled={!settings.contextAwareness}
              value={settings.maxContextChars}
              onChange={(event) =>
                update({ maxContextChars: event.target.valueAsNumber || 0 })
              }
            />
          </label>
        </fieldset>

        <p className="hint">
          Select text on any page and press the Lingo button that appears, or
          use the keyboard shortcut (Alt+Shift+L by default). You can change the
          shortcut at chrome://extensions/shortcuts.
        </p>

        <div className="actions">
          <button type="submit">Save</button>
          <output>{saved ? "Saved" : ""}</output>
        </div>
      </form>
    </main>
  );
}
