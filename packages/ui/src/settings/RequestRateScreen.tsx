import {
  defaultSettings,
  MAX_PAGE_REQUESTS_PER_SECOND,
  PAGE_REQUEST_RATE_PRESETS,
} from "@lingo/core";
import { useState } from "react";
import { FieldMessage } from "../controls/FieldMessage.tsx";
import { TextField } from "../controls/TextField.tsx";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { DetailScreenProps } from "./types.ts";

const DEFAULT_RATE = defaultSettings().pageRequestsPerSecond;

/** Reads a rate that was typed in. `undefined` for anything that is not one. */
function parseRate(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const rate = Number(text);
  return rate >= 1 && rate <= MAX_PAGE_REQUESTS_PER_SECOND ? rate : undefined;
}

/** How many page translation requests are sent per second at most. */
export function RequestRateScreen({
  settings,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps) {
  const stored = settings.pageRequestsPerSecond;
  const listed = PAGE_REQUEST_RATE_PRESETS.includes(stored);
  // "Other…" stays selected while its field is empty or holds no rate.
  const [other, setOther] = useState(!listed);
  const [typed, setTyped] = useState(listed ? "" : String(stored));

  const store = (rate: number) =>
    onSettingsChange({ ...settings, pageRequestsPerSecond: rate });
  const typedRate = parseRate(typed);

  return (
    <>
      <PanelHeader title="Request rate" onBack={onBack} onClose={onClose} />
      <div className="lingo-settings__content">
        <p className="lingo-settings__note">
          Lingo sends at most this many translation requests each second,
          counting every tab. Lower it if your provider tells you that you are
          sending too many.
        </p>
        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Requests per second</h2>
        <div role="radiogroup" aria-label="Requests per second">
          {PAGE_REQUEST_RATE_PRESETS.map((rate) => (
            <OptionRow
              key={rate}
              name="request-rate"
              label={String(rate)}
              description={rate === DEFAULT_RATE ? "Default" : undefined}
              checked={!other && rate === stored}
              onSelect={() => {
                setOther(false);
                store(rate);
              }}
            />
          ))}
          <OptionRow
            name="request-rate"
            label="Other…"
            checked={other}
            onSelect={() => {
              setOther(true);
              // Until a rate is typed, the one in use stays.
              if (typedRate !== undefined) store(typedRate);
            }}
          />
        </div>
        {other && (
          <>
            <div className="lingo-settings__field">
              <TextField
                label="Requests per second"
                inputMode="numeric"
                placeholder={`1 to ${MAX_PAGE_REQUESTS_PER_SECOND}`}
                value={typed}
                invalid={typed.trim() !== "" && typedRate === undefined}
                onChange={(value) => {
                  setTyped(value);
                  const rate = parseRate(value);
                  if (rate !== undefined) store(rate);
                }}
              />
            </div>
            {typed.trim() !== "" && typedRate === undefined && (
              <div className="lingo-settings__message">
                <FieldMessage tone="danger">
                  Not stored. Enter a whole number from 1 to{" "}
                  {MAX_PAGE_REQUESTS_PER_SECOND}.
                </FieldMessage>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
