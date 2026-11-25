import { useState } from "react";
import { TextField } from "../controls/TextField.tsx";
import { OptionRow } from "./OptionRow.tsx";

export interface ModelListProps {
  /** The models to offer. */
  models: readonly { id: string; label: string }[];
  /** The model that answers when none is stored. */
  defaultModel: string;
  /** The stored model ID. Undefined means the default. */
  model: string | undefined;
  onChange: (model: string | undefined) => void;
}

/** A provider's models, and a field for any other model ID. */
export function ModelList({
  models,
  defaultModel,
  model,
  onChange,
}: ModelListProps) {
  const chosen = model ?? defaultModel;
  const listed = models.some(({ id }) => id === chosen);
  // "Other…" stays selected while its field is still empty.
  const [other, setOther] = useState(!listed);
  const [typed, setTyped] = useState(listed ? "" : chosen);

  return (
    <div role="radiogroup" aria-label="Model">
      {models.map(({ id, label }) => (
        <OptionRow
          key={id}
          name="model"
          label={label}
          description={id === defaultModel ? "Default" : undefined}
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
          // Until an ID is typed, the default model answers.
          onChange(typed.trim() || undefined);
        }}
      />
      {other && (
        <div className="lingo-settings__field">
          <TextField
            label="Model ID"
            spellCheck={false}
            placeholder={defaultModel}
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
