import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { type DrawerAnswer, isRuntimeMessage } from "../../src/messaging.ts";

/**
 * The settings, in a panel on the right edge of the page. It opens when the
 * toolbar button is pressed, and closes on a second press, on Escape, or from
 * its own Close button.
 *
 * The settings themselves are an extension page in an iframe. The API key is
 * typed and shown there, so neither this script nor the page can read it.
 */
export function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  // Mirrors `open`, so that a message can be answered at once.
  const isOpen = useRef(false);

  useEffect(() => {
    const show = (next: boolean) => {
      isOpen.current = next;
      setOpen(next);
    };

    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (answer: DrawerAnswer) => void,
    ) => {
      if (!isRuntimeMessage(message) || message.type !== "settings-drawer") {
        return;
      }
      const next =
        message.action === "toggle"
          ? !isOpen.current
          : message.action === "open";
      const changed = next !== isOpen.current;
      show(next);
      sendResponse(changed ? (next ? "opened" : "closed") : "unchanged");
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") show(false);
    };

    browser.runtime.onMessage.addListener(onMessage);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!open) return null;
  return (
    <div className="lingo lingo-drawer">
      <iframe
        title="Lingo settings"
        src={browser.runtime.getURL("/settings-drawer.html")}
        // Puts the keyboard in the panel that was just asked for.
        ref={(frame) => frame?.focus()}
      />
    </div>
  );
}
