import { type CapturedContext, chooseMode, type LookupMode } from "@lingo/core";
import { LookupCard } from "@lingo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { captureContext } from "../../src/context/dom.ts";
import { openLookup } from "../../src/lookup-client.ts";
import {
  applyLookupEvent,
  initialLookupState,
  type LookupState,
} from "../../src/lookup-state.ts";
import {
  MAX_SELECTION_CHARS,
  type RuntimeMessage,
} from "../../src/messaging.ts";
import { type Point, placePanel, placeTrigger } from "../../src/position.ts";

interface Trigger {
  position: Point;
  captured: CapturedContext;
}

interface Panel {
  position: Point;
  lookup: LookupState;
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The in-page UI: a small button that appears next to a new selection, and
 * the panel with the streaming answer that it opens.
 */
export function LookupApp({ host }: { host: Element }) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const cancelLookup = useRef<() => void>(() => {});

  const close = useCallback(() => {
    cancelLookup.current();
    setTrigger(null);
    setPanel(null);
  }, []);

  const run = useCallback(
    (captured: CapturedContext, mode: LookupMode, position: Point) => {
      cancelLookup.current();
      setTrigger(null);
      setPanel({ position, lookup: initialLookupState(mode, captured) });
      cancelLookup.current = openLookup(
        { type: "start", mode, context: captured },
        (event) =>
          setPanel(
            (current) =>
              current && {
                ...current,
                lookup: applyLookupEvent(current.lookup, event),
              },
          ),
      );
    },
    [],
  );

  useEffect(() => {
    const insideLingo = (event: Event) => event.composedPath().includes(host);

    const onMouseUp = (event: MouseEvent) => {
      if (insideLingo(event)) return;
      const pointer = { x: event.clientX, y: event.clientY };
      // Read the selection after the browser has finished updating it.
      setTimeout(() => {
        const captured = captureContext();
        if (!captured || captured.selection.length > MAX_SELECTION_CHARS) {
          setTrigger(null);
          return;
        }
        setTrigger({ captured, position: placeTrigger(pointer, viewport()) });
      }, 0);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!insideLingo(event)) close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    // The button is pinned to the viewport, so it would drift off the text.
    const onScroll = () => setTrigger(null);

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, { capture: true });
      cancelLookup.current();
    };
  }, [host, close]);

  const openSettings = () => {
    const message: RuntimeMessage = { type: "open-settings" };
    void browser.runtime.sendMessage(message).catch(() => {});
  };

  if (panel) {
    const { lookup, position } = panel;
    const placed = placePanel(position, viewport());
    return (
      <div className="lingo-panel" style={{ left: placed.x, top: placed.y }}>
        <LookupCard
          mode={lookup.mode}
          status={lookup.status}
          text={lookup.text}
          context={lookup.context}
          error={lookup.error}
          onModeChange={(mode) => run(lookup.captured, mode, position)}
          onRetry={() => run(lookup.captured, lookup.mode, position)}
          onOpenSettings={openSettings}
          onClose={close}
        />
      </div>
    );
  }

  if (trigger) {
    const { captured, position } = trigger;
    return (
      <button
        type="button"
        className="lingo-trigger"
        style={{ left: position.x, top: position.y }}
        aria-label="Look up with Lingo"
        // Keep the page's selection when the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => run(captured, chooseMode(captured.selection), position)}
      >
        L
      </button>
    );
  }

  return null;
}
