import {
  type Engine,
  engineForTask,
  engineName,
  type ModelInfo,
  PROVIDER_IDS,
  type ProviderId,
} from "@lingo/core";
import { Copy, Eye, EyeOff, Trash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../controls/Button.tsx";
import { FieldMessage } from "../controls/FieldMessage.tsx";
import { IconButton } from "../controls/IconButton.tsx";
import { SearchField } from "../controls/SearchField.tsx";
import { SegmentedControl } from "../controls/SegmentedControl.tsx";
import { TextArea } from "../controls/TextArea.tsx";
import { TextButton } from "../controls/TextButton.tsx";
import { TextField } from "../controls/TextField.tsx";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { TASKS } from "./tasks.ts";
import type { DetailScreenProps, KeyCheck } from "./types.ts";

/** A list longer than this gets a search field. */
const SEARCHABLE_FROM = 8;

/** Where the check of the key in the field stands. */
interface Check {
  status: "idle" | "checking" | KeyCheck["status"];
  models: ModelInfo[];
}

const NOT_CHECKED: Check = { status: "idle", models: [] };

/** The model of an engine, as much of it as is stored. */
type Model = Pick<ModelInfo, "id" | "label" | "capabilities">;

/** Reads extra parameters. `undefined` when the text is not a JSON object. */
function parseParameters(
  text: string,
): { value: Record<string, unknown> | undefined } | undefined {
  if (text.trim() === "") return { value: undefined };
  try {
    const value: unknown = JSON.parse(text);
    const isObject =
      typeof value === "object" && value !== null && !Array.isArray(value);
    return isObject ? { value: value as Record<string, unknown> } : undefined;
  } catch {
    return undefined;
  }
}

/** Two engines are the same when they would be stored the same. */
const sameEngine = (a: Engine, b: Engine) =>
  JSON.stringify([
    a.provider,
    a.model,
    a.modelLabel,
    a.name,
    a.capabilities,
    a.parameters,
  ]) ===
  JSON.stringify([
    b.provider,
    b.model,
    b.modelLabel,
    b.name,
    b.capabilities,
    b.parameters,
  ]);

export interface EngineScreenProps extends DetailScreenProps {
  /** The engine to show. Without it, the screen adds an engine. */
  engineId?: string;
  /** An engine that a new one starts as a copy of. */
  copyOf?: string;
  /** Called to add an engine like the one with this ID. */
  onDuplicate: (engineId: string) => void;
}

/**
 * One engine: its provider, API key, model, name, and extra parameters.
 * Without an `engineId` it is the form that adds an engine, which exists
 * once "Add engine" is pressed. It can start as a copy of another engine. An engine that exists is stored again each
 * time it changes, as long as what is in the form is complete.
 */
export function EngineScreen({
  engineId,
  copyOf,
  onDuplicate,
  settings,
  providers,
  engineKeys,
  onCheckKey,
  onEngineSave,
  onEngineRemove,
  onBack,
  onClose,
}: EngineScreenProps) {
  const stored = settings.engines.find((engine) => engine.id === engineId);
  /** What a new engine starts as: a copy of this one, apart from its name. */
  const original = stored
    ? undefined
    : settings.engines.find((engine) => engine.id === copyOf);
  const start = stored ?? original;
  const storedKey = stored ? (engineKeys[stored.id] ?? "") : "";
  const [id] = useState(() => stored?.id ?? crypto.randomUUID());

  const [provider, setProvider] = useState<ProviderId>(
    start?.provider ?? "anthropic",
  );
  // A new engine starts without a key, unless it is a copy: no key is put
  // in for the user that they did not ask for.
  const copiedKey = original ? (engineKeys[original.id] ?? "") : "";
  const [key, setKey] = useState(stored ? storedKey : copiedKey);
  const [revealed, setRevealed] = useState(false);
  const [check, setCheck] = useState<Check>(NOT_CHECKED);
  /** The key that `check` is about. */
  const [checkedKey, setCheckedKey] = useState("");
  const [model, setModel] = useState<Model | undefined>(
    start && {
      id: start.model,
      label: start.modelLabel ?? start.model,
      capabilities: start.capabilities,
    },
  );
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [name, setName] = useState(stored?.name ?? "");
  const [parameters, setParameters] = useState(
    start?.parameters ? JSON.stringify(start.parameters, null, 2) : "",
  );
  /** Counts checks, so that only the latest one reports back. */
  const latestCheck = useRef(0);

  async function runCheck(of: ProviderId, value: string) {
    const candidate = value.trim();
    latestCheck.current += 1;
    const mine = latestCheck.current;
    setCheckedKey(candidate);
    if (!candidate) {
      setCheck(NOT_CHECKED);
      return;
    }
    setCheck({ status: "checking", models: [] });
    const result = await onCheckKey(of, candidate);
    if (mine !== latestCheck.current) return;
    setCheck(result);
    // A model that the key's list does not have was typed in by hand.
    setModel((current) => {
      const listed = result.models.some(({ id }) => id === current?.id);
      if (current && result.status === "accepted" && !listed) {
        setOther(true);
        setTyped(current.id);
      }
      return current;
    });
  }

  // The key the screen opens with is checked at once, to list its models.
  useEffect(() => {
    if (key) void runCheck(provider, key);
  }, []);

  const changeProvider = (next: ProviderId) => {
    // A key belongs to one provider, so the field starts over.
    setProvider(next);
    setKey("");
    setModel(undefined);
    setOther(false);
    setTyped("");
    setQuery("");
    void runCheck(next, "");
  };

  const submitKey = () => {
    if (check.status !== "checking" && key.trim() !== checkedKey) {
      void runCheck(provider, key);
    }
  };

  const parsed = parseParameters(parameters);
  const draft: Engine | undefined =
    model && parsed
      ? {
          id,
          provider,
          model: model.id,
          modelLabel: model.label === model.id ? undefined : model.label,
          name: name.trim() || undefined,
          capabilities: model.capabilities,
          parameters: parsed.value,
        }
      : undefined;
  const trimmedKey = key.trim();
  // A key is good when its provider just accepted it. The stored key of an
  // engine stays good while its provider cannot be asked.
  const keyIsGood =
    trimmedKey !== "" &&
    ((check.status === "accepted" && trimmedKey === checkedKey) ||
      (stored !== undefined &&
        trimmedKey === storedKey &&
        provider === stored.provider &&
        check.status !== "rejected"));

  // An engine that exists is stored again whenever the form has a complete
  // engine that differs from it.
  useEffect(() => {
    if (!stored || !draft || !keyIsGood) return;
    if (sameEngine(draft, stored) && trimmedKey === storedKey) return;
    onEngineSave(draft, trimmedKey);
  });

  const providerName = providers[provider].label;
  const listed = check.status === "accepted";
  const sought = query.trim().toLocaleLowerCase();
  // Until the list is in, an engine shows the one model it has.
  const models: Model[] = listed
    ? check.models
    : model && !other
      ? [model]
      : [];
  const matching = models.filter(({ id, label }) =>
    [id, label].some((text) => text.toLocaleLowerCase().includes(sought)),
  );
  const usedFor = stored
    ? TASKS.filter(
        ({ task }) => engineForTask(settings, task)?.id === stored.id,
      )
    : [];

  return (
    <>
      <PanelHeader
        title={stored ? engineName(stored) : "Add engine"}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="lingo-settings__content">
        <h2 className="lingo-group-label">Provider</h2>
        <div className="lingo-settings__field">
          <SegmentedControl
            label="Provider"
            options={PROVIDER_IDS.map((value) => ({
              value,
              label: providers[value].label,
            }))}
            value={provider}
            onChange={changeProvider}
          />
        </div>

        <h2 className="lingo-group-label">API key</h2>
        <div className="lingo-settings__field">
          <TextField
            label="API key"
            type={revealed ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            value={key}
            onChange={setKey}
            onBlur={submitKey}
            onKeyDown={(event) => event.key === "Enter" && submitKey()}
            busy={check.status === "checking"}
            invalid={
              check.status === "rejected" || check.status === "unreachable"
            }
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
            status={check.status}
            providerName={providerName}
            keysUrl={providers[provider].keysUrl}
            copiedFrom={
              original &&
              provider === original.provider &&
              trimmedKey !== "" &&
              trimmedKey === copiedKey
                ? engineName(original)
                : undefined
            }
            isStoredKey={stored !== undefined && trimmedKey === storedKey}
            onRetry={() => void runCheck(provider, key)}
          />
        </div>

        <h2 className="lingo-group-label">Model</h2>
        {!listed && (
          <p className="lingo-settings__note lingo-settings__note--hint">
            {check.status === "checking"
              ? "Asking which models this key can use…"
              : "Enter the API key to see the models it can use."}
          </p>
        )}
        {models.length > SEARCHABLE_FROM && (
          <div className="lingo-settings__field">
            <SearchField
              label="Search models"
              value={query}
              onChange={setQuery}
            />
          </div>
        )}
        <div role="radiogroup" aria-label="Model">
          {matching.map((entry) => (
            <OptionRow
              key={entry.id}
              name="model"
              label={entry.label}
              checked={!other && entry.id === model?.id}
              onSelect={() => {
                setOther(false);
                setModel(entry);
              }}
            />
          ))}
          <OptionRow
            name="model"
            label="Other…"
            checked={other}
            onSelect={() => {
              setOther(true);
              setModel(typed.trim() ? modelTyped(typed) : undefined);
            }}
          />
        </div>
        {other && (
          <div className="lingo-settings__field">
            <TextField
              label="Model ID"
              spellCheck={false}
              placeholder="The model's ID, as its provider writes it"
              value={typed}
              onChange={(value) => {
                setTyped(value);
                setModel(value.trim() ? modelTyped(value) : undefined);
              }}
            />
          </div>
        )}

        <h2 className="lingo-group-label">Name</h2>
        <div className="lingo-settings__field">
          <TextField
            label="Name"
            placeholder={model?.label ?? "Goes by its model if left empty"}
            value={name}
            onChange={setName}
          />
        </div>

        <h2 className="lingo-group-label">Extra parameters</h2>
        <div className="lingo-settings__field">
          <TextArea
            label="Extra parameters"
            placeholder="{}"
            value={parameters}
            onChange={setParameters}
            invalid={!parsed}
          />
        </div>
        {parsed ? (
          <p className="lingo-settings__note">
            Sent along with every request of this engine, as JSON. For what a
            provider's own settings do not cover.
          </p>
        ) : (
          <div className="lingo-settings__message">
            <FieldMessage tone="danger">
              Not stored. This is not a JSON object.
            </FieldMessage>
          </div>
        )}

        {stored ? (
          <>
            <hr className="lingo-divider" />
            <p className="lingo-settings__note">
              {usedFor.length > 0
                ? `Used for ${listOf(usedFor.map(({ label }) => label.toLocaleLowerCase()))}. `
                : "Not used for any task. "}
              Changes are stored as you make them.
            </p>
            <div className="lingo-settings__field lingo-settings__field--buttons">
              <TextButton
                leadingIcon={Copy}
                onClick={() => onDuplicate(stored.id)}
              >
                Duplicate
              </TextButton>
              <TextButton
                className="lingo-text-button lingo-text-button--danger"
                leadingIcon={Trash}
                onClick={() => {
                  onEngineRemove(stored.id);
                  onBack();
                }}
              >
                Remove engine
              </TextButton>
            </div>
          </>
        ) : (
          <div className="lingo-settings__field lingo-settings__field--action">
            <Button
              variant="primary"
              disabled={!draft || !keyIsGood}
              onClick={() => {
                if (!draft) return;
                onEngineSave(draft, trimmedKey);
                onBack();
              }}
            >
              Add engine
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

const modelTyped = (text: string): Model => ({
  id: text.trim(),
  label: text.trim(),
});

/** "a", "a and b", or "a, b, and c". */
function listOf(items: string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(items);
}

interface KeyMessageProps {
  status: Check["status"];
  providerName: string;
  keysUrl: string;
  /** The engine this one is a copy of, while it still has that one's key. */
  copiedFrom: string | undefined;
  /** Whether the key in the field is the one this engine has stored. */
  isStoredKey: boolean;
  onRetry: () => void;
}

/** The line under the key field: what became of the key in it. */
function KeyMessage({
  status,
  providerName,
  keysUrl,
  copiedFrom,
  isStoredKey,
  onRetry,
}: KeyMessageProps) {
  if (status === "checking") {
    return <FieldMessage>Checking the key with {providerName}…</FieldMessage>;
  }
  if (status === "rejected") {
    return (
      <FieldMessage tone="danger">
        Not stored. {providerName} rejected this key.
      </FieldMessage>
    );
  }
  if (status === "unreachable") {
    return (
      <FieldMessage tone="danger">
        Lingo could not reach {providerName}.
        <button type="button" className="lingo-link" onClick={onRetry}>
          Try again
        </button>
      </FieldMessage>
    );
  }
  if (status === "accepted" && copiedFrom) {
    return <FieldMessage>The same key as {copiedFrom}.</FieldMessage>;
  }
  if (status === "accepted" && !isStoredKey) {
    return (
      <FieldMessage tone="success">
        {providerName} accepted this key.
      </FieldMessage>
    );
  }
  return (
    <FieldMessage>
      Stored only in this browser.
      <a className="lingo-link" href={keysUrl} target="_blank" rel="noreferrer">
        Create a key
      </a>
    </FieldMessage>
  );
}
