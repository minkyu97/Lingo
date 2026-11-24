import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { type DrawerAnswer, isRuntimeMessage } from "../../src/messaging.ts";

/**
 * Closed, open, or closing: still drawn while it slides out, so that it
 * leaves the way it came.
 */
type Phase = "closed" | "open" | "closing";

/** Puts the keyboard in the panel that was just asked for. */
const focusFrame = (frame: HTMLIFrameElement | null) => frame?.focus();

/**
 * The settings, in a panel on the right edge of the page. It opens when the
 * toolbar button is pressed, and closes on a second press, on Escape, or from
 * its own Close button. It slides in and out.
 *
 * The settings themselves are an extension page in an iframe. The API key is
 * typed and shown there, so neither this script nor the page can read it.
 */
export function SettingsDrawer() {
  const [phase, setPhase] = useState<Phase>("closed");
  // Whether the drawer is meant to be open, so that a message can be
  // answered at once. A drawer that is sliding out already counts as closed.
  const isOpen = useRef(false);

  useEffect(() => {
    const show = (next: boolean) => {
      isOpen.current = next;
      setPhase((phase) => {
        if (next) return "open";
        // A drawer that is not drawn has nothing to slide out.
        return phase === "closed" ? "closed" : "closing";
      });
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

  if (phase === "closed") return null;
  return (
    <div
      className="lingo lingo-drawer"
      data-closing={phase === "closing"}
      // The drawer leaves the page once it has slid out of view.
      onAnimationEnd={() =>
        setPhase((phase) => (phase === "closing" ? "closed" : phase))
      }
    >
      <iframe
        title="Lingo settings"
        src={browser.runtime.getURL("/settings-drawer.html")}
        ref={focusFrame}
      />
    </div>
  );
}
