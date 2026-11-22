import { type CapturedContext, chooseMode, type LookupMode } from "@lingo/core";
import { LookupCard } from "@lingo/ui";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { browser } from "wxt/browser";
import { captureContext } from "../../src/context/dom.ts";
import { openLookup } from "../../src/lookup-client.ts";
import {
  applyLookupEvent,
  initialLookupState,
  type LookupState,
} from "../../src/lookup-state.ts";
import {
  isRuntimeMessage,
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

/** Just below the selection, or below the focused field when the selection has no box. */
function selectionAnchor(): Point {
  const selection = document.getSelection();
  const range =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : undefined;
  const box =
    range && (range.width > 0 || range.height > 0)
      ? range
      : document.activeElement?.getBoundingClientRect();
  if (!box) return { x: window.innerWidth / 2, y: 80 };
  return { x: box.left, y: box.bottom + 8 };
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

  // The keyboard shortcut arrives from the background. Every frame gets the
  // message, and only the one that holds the selection answers.
  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isRuntimeMessage(message) || message.type !== "lookup-selection") {
        return;
      }
      const captured = captureContext();
      if (!captured || captured.selection.length > MAX_SELECTION_CHARS) return;
      run(captured, chooseMode(captured.selection), selectionAnchor());
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [run]);

  const openSettings = () => {
    const message: RuntimeMessage = { type: "open-settings" };
    void browser.runtime.sendMessage(message).catch(() => {});
  };

  if (panel) {
    const { lookup, position } = panel;
    const placed = placePanel(position, viewport());
    const style = {
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      "--lingo-card-max-height": `${placed.maxHeight}px`,
    } as CSSProperties;
    return (
      <div className="lingo-panel" style={style}>
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
