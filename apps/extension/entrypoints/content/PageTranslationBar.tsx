import { PageBar } from "@lingo/ui";
import { useSyncExternalStore } from "react";
import { browser } from "wxt/browser";
import type { RuntimeMessage } from "../../src/messaging.ts";
import { type BarAction, describeBar } from "../../src/page-translation/bar.ts";
import type { PageControl } from "./page-translation.ts";

function openSettings() {
  const message: RuntimeMessage = { type: "settings-drawer", action: "open" };
  void browser.runtime.sendMessage(message).catch(() => {});
}

/**
 * The page bar of the top frame: at the bottom of the viewport for as long
 * as the page is translated.
 */
export function PageTranslationBar({ control }: { control: PageControl }) {
  const status = useSyncExternalStore(control.subscribe, control.getStatus);
  const content = describeBar(status);
  if (!content) return null;

  const actions: Record<BarAction, () => void> = {
    stop: control.stop,
    retry: control.retry,
    settings: openSettings,
    reload: () => location.reload(),
  };
  return (
    <div className="lingo-page-bar-host">
      <PageBar
        state={content.state}
        label={content.label}
        action={{
          label: content.actionLabel,
          onClick: actions[content.action],
        }}
        onStop={control.stop}
      />
    </div>
  );
}
