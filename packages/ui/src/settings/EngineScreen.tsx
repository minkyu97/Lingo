import { PROVIDER_IDS, type ProviderId } from "@lingo/core";
import { Eye, EyeOff } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { FieldMessage } from "../controls/FieldMessage.tsx";
import { IconButton } from "../controls/IconButton.tsx";
import { SegmentedControl } from "../controls/SegmentedControl.tsx";
import { TextField } from "../controls/TextField.tsx";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { DetailScreenProps, KeyStatus, ProviderChoice } from "./types.ts";

/** Which provider answers lookups, with which key and which model. */
export function EngineScreen({
  settings,
  providers,
  apiKeys,
  keyStatus,
  onSettingsChange,
  onApiKeySubmit,
  onBack,
  onClose,
}: DetailScreenProps) {
  const providerId = settings.provider;
  const provider = providers[providerId];

  const setModel = (model: string | undefined) => {
    const models = { ...settings.models };
    if (model) models[providerId] = model;
    else delete models[providerId];
    onSettingsChange({ ...settings, models });
  };

  return (
    <>
      <PanelHeader
        title="Translation engine"
        onBack={onBack}
        onClose={onClose}
      />
      <div className="lingo-settings__content">
        <h2 className="lingo-group-label">Provider</h2>
        <div className="lingo-settings__field">
          <SegmentedControl
            label="Provider"
            options={PROVIDER_IDS.map((id) => ({
              value: id,
              label: providers[id].label,
            }))}
            value={providerId}
            onChange={(id: ProviderId) =>
              onSettingsChange({ ...settings, provider: id })
            }
          />
        </div>

        {/* Keyed by provider, so each one starts from its own key and model. */}
        <Fragment key={providerId}>
          <h2 className="lingo-group-label">API key</h2>
          <KeyField
            provider={provider}
            storedKey={apiKeys[providerId] ?? ""}
            status={keyStatus}
            onSubmit={(key) => onApiKeySubmit(providerId, key)}
          />

          <h2 className="lingo-group-label">Model</h2>
          <ModelList
            provider={provider}
            model={settings.models[providerId]}
            onChange={setModel}
          />
        </Fragment>

        <hr className="lingo-divider" />
        <p className="lingo-settings__note">
          Lingo sends your text straight from this browser to the provider you
          choose, using your own API key.
        </p>
      </div>
    </>
  );
}

interface KeyFieldProps {
  provider: ProviderChoice;
  storedKey: string;
  status: KeyStatus;
  onSubmit: (key: string) => void;
}

/**
 * The key is submitted when the field is left or Enter is pressed. The line
 * under the field then says what became of it.
 */
function KeyField({ provider, storedKey, status, onSubmit }: KeyFieldProps) {
  const [draft, setDraft] = useState(storedKey);
  const [revealed, setRevealed] = useState(false);
  // What was last handed over, so leaving the field again does not repeat it.
  const submitted = useRef(storedKey);

  const submit = () => {
    const key = draft.trim();
    if (status === "checking" || key === submitted.current) return;
    submitted.current = key;
    onSubmit(key);
  };

  return (
    <>
      <div className="lingo-settings__field">
        <TextField
          label="API key"
          type={revealed ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your key"
          value={draft}
          onChange={setDraft}
          onBlur={submit}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          busy={status === "checking"}
          invalid={status === "rejected" || status === "unreachable"}
          trailing={
            <IconButton
              icon={revealed ? EyeOff : Eye}
              label={revealed ? "Hide key" : "Show key"}
              // Keeps the focus in the field, so this does not submit the key.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRevealed((shown) => !shown)}
            />
          }
        />
      </div>
      <div className="lingo-settings__message">
        <KeyMessage
          provider={provider}
          status={status}
          onRetry={() => onSubmit(draft.trim())}
        />
      </div>
    </>
  );
}

function KeyMessage({
  provider,
  status,
  onRetry,
}: {
  provider: ProviderChoice;
  status: KeyStatus;
  onRetry: () => void;
}) {
  const name = provider.label;
  switch (status) {
    case "checking":
      return <FieldMessage>Checking the key with {name}…</FieldMessage>;
    case "saved":
      return (
        <FieldMessage tone="success">
          Saved. {name} accepted this key.
        </FieldMessage>
      );
    case "rejected":
      return (
        <FieldMessage tone="danger">
          Not saved. {name} rejected this key.
        </FieldMessage>
      );
    case "unreachable":
      return (
        <FieldMessage tone="danger">
          Not saved. Lingo could not reach {name}.
          <button type="button" className="lingo-link" onClick={onRetry}>
            Try again
          </button>
        </FieldMessage>
      );
    case "idle":
      return (
        <FieldMessage>
          Stored only in this browser.
          <a
            className="lingo-link"
            href={provider.keysUrl}
            target="_blank"
            rel="noreferrer"
          >
            Create a key
          </a>
        </FieldMessage>
      );
  }
}

interface ModelListProps {
  provider: ProviderChoice;
  /** The stored model ID. Undefined means the provider's default. */
  model: string | undefined;
  onChange: (model: string | undefined) => void;
}

/** The provider's models, and a field for any other model ID. */
function ModelList({ provider, model, onChange }: ModelListProps) {
  const chosen = model ?? provider.defaultModel;
  const listed = provider.models.some(({ id }) => id === chosen);
  // "Other…" stays selected while its field is still empty.
  const [other, setOther] = useState(!listed);
  const [typed, setTyped] = useState(listed ? "" : chosen);

  return (
    <div role="radiogroup" aria-label="Model">
      {provider.models.map(({ id, label }) => (
        <OptionRow
          key={id}
          name="model"
          label={label}
          description={id === provider.defaultModel ? "Default" : undefined}
          checked={!other && id === chosen}
          onSelect={() => {
            setOther(false);
            onChange(id);
          }}
        />
      ))}
      <OptionRow
        name="model"
        label="Other…"
        checked={other}
        onSelect={() => {
          setOther(true);
          // Until an ID is typed, the provider's default model answers.
          onChange(typed.trim() || undefined);
        }}
      />
      {other && (
        <div className="lingo-settings__field">
          <TextField
            label="Model ID"
            spellCheck={false}
            placeholder={provider.defaultModel}
            value={typed}
            onChange={(value) => {
              setTyped(value);
              onChange(value.trim() || undefined);
            }}
          />
        </div>
      )}
    </div>
  );
}
