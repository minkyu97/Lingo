import { defaultSettings, PAGE_REQUEST_RATE_PRESETS } from "@lingo/core";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { DetailScreenProps } from "./types.ts";

const DEFAULT_RATE = defaultSettings().pageRequestsPerSecond;

/** How many page translation requests are sent per second at most. */
export function RequestRateScreen({
  settings,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps) {
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
              checked={rate === settings.pageRequestsPerSecond}
              onSelect={() =>
                onSettingsChange({ ...settings, pageRequestsPerSecond: rate })
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
