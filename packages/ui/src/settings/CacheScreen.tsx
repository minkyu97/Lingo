import { useEffect, useId, useRef, useState } from "react";
import { Switch } from "../controls/Switch.tsx";
import { TextButton } from "../controls/TextButton.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { CacheUsage, DetailScreenProps } from "./types.ts";

/** How long the button says that the cache was cleared, in milliseconds. */
const CLEARED_NOTICE_MS = 2000;

const KB = 1024;
const MB = 1024 * KB;

/** A size as a person reads it: "3.2 MB", "9 MB", "412 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / KB))} KB`;
  return `${(bytes / MB).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** What the cache holds, in words. */
function describeUsage({ entries, bytes, maxBytes }: CacheUsage, on: boolean) {
  if (entries === 0) return "Nothing is stored.";
  const held = `${entries.toLocaleString("en-US")} answer${entries === 1 ? "" : "s"}, ${formatBytes(bytes)} of ${formatBytes(maxBytes)}.`;
  return on
    ? `${held} When it is full, the answers used longest ago make room.`
    : `${held} They are kept, and not used, while this is off.`;
}

/** Whether answers are reused, how many are stored, and a way to drop them. */
export function CacheScreen({
  settings,
  cache,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps) {
  const switchLabel = useId();
  const [cleared, setCleared] = useState(false);
  const notice = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(notice.current), []);

  const clear = () => {
    cache.onClear();
    setCleared(true);
    clearTimeout(notice.current);
    notice.current = setTimeout(() => setCleared(false), CLEARED_NOTICE_MS);
  };

  return (
    <>
      <PanelHeader title="Cache" onBack={onBack} onClose={onClose} />
      <div className="lingo-settings__content">
        <div className="lingo-switch-row">
          <span id={switchLabel}>Reuse answers</span>
          <Switch
            aria-labelledby={switchLabel}
            checked={settings.cacheResponses}
            onChange={(cacheResponses) =>
              onSettingsChange({ ...settings, cacheResponses })
            }
          />
        </div>
        <p className="lingo-settings__note">
          Lingo keeps the answer to each request, so the same text is not sent
          to a provider twice: a page you come back to, or a word you look up
          again. Answers stay in this browser.
        </p>

        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Stored</h2>
        {cache.usage && (
          <p className="lingo-settings__note lingo-settings__note--hint">
            {describeUsage(cache.usage, settings.cacheResponses)}
          </p>
        )}
        <div className="lingo-settings__field lingo-settings__field--quiet-action">
          <TextButton
            disabled={cleared || cache.usage?.entries === 0}
            onClick={clear}
          >
            {cleared ? "Cleared" : "Clear cache"}
          </TextButton>
        </div>
      </div>
    </>
  );
}
