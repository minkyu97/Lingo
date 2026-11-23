import { type CapturedContext, chooseMode, type LookupMode } from "@lingo/core";
import { LookupCard, LookupTrigger } from "@lingo/ui";
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { browser } from "wxt/browser";
import { captureContext } from "../../src/context/dom.ts";
import { followPointer } from "../../src/drag.ts";
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
import {
  type Point,
  placeMovedPanel,
  placePanel,
  placeTrigger,
} from "../../src/position.ts";

interface Trigger {
  position: Point;
  captured: CapturedContext;
}

interface Panel {
  /** Where the lookup was asked for. The card opens just below or above it. */
  anchor: Point;
  /** Where the user dragged the card's top-left corner to, once they have. */
  moved?: Point;
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
 * the panel with the streaming answer that it opens. The panel can be dragged
 * by its header, and pinned so that only its Close button closes it.
 */
export function LookupApp({ host }: { host: Element }) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  // A pinned panel stays open until its Close button is pressed.
  const [pinned, setPinned] = useState(false);
  const panelElement = useRef<HTMLDivElement>(null);
  const cancelLookup = useRef<() => void>(() => {});

  const close = useCallback(() => {
    cancelLookup.current();
    setTrigger(null);
    setPanel(null);
    setPinned(false);
  }, []);

  /** Sends a request, and feeds what comes back into the card. */
  const request = useCallback((captured: CapturedContext, mode: LookupMode) => {
    cancelLookup.current();
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
  }, []);

  /**
   * Looks up a new selection, in a card that opens at `anchor`. A pinned card
   * shows the new answer where it already is.
   */
  const lookUp = useCallback(
    (captured: CapturedContext, mode: LookupMode, anchor: Point) => {
      const lookup = initialLookupState(mode, captured);
      setTrigger(null);
      setPanel((current) =>
        pinned && current ? { ...current, lookup } : { anchor, lookup },
      );
      request(captured, mode);
    },
    [pinned, request],
  );

  /** Asks again about the same selection, leaving the card where it is. */
  const lookUpAgain = (mode: LookupMode) => {
    if (!panel) return;
    const { captured } = panel.lookup;
    setPanel({ ...panel, lookup: initialLookupState(mode, captured) });
    request(captured, mode);
  };

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (!panelElement.current) return;
    followPointer(event, panelElement.current, (moved) =>
      setPanel((current) => current && { ...current, moved }),
    );
  };

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
      if (!insideLingo(event) && !pinned) close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pinned) close();
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
  }, [host, close, pinned]);

  // The keyboard shortcut arrives from the background. Every frame gets the
  // message, and only the one that holds the selection answers.
  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isRuntimeMessage(message) || message.type !== "lookup-selection") {
        return;
      }
      const captured = captureContext();
      if (!captured || captured.selection.length > MAX_SELECTION_CHARS) return;
      lookUp(captured, chooseMode(captured.selection), selectionAnchor());
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [lookUp]);

  const openSettings = () => {
    const message: RuntimeMessage = { type: "open-settings" };
    void browser.runtime.sendMessage(message).catch(() => {});
  };

  return (
    <>
      {panel && renderPanel(panel)}
      {trigger && (
        <LookupTrigger
          style={{ left: trigger.position.x, top: trigger.position.y }}
          // Keep the page's selection when the button is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            lookUp(
              trigger.captured,
              chooseMode(trigger.captured.selection),
              trigger.position,
            )
          }
        />
      )}
    </>
  );

  function renderPanel({ lookup, anchor, moved }: Panel) {
    const placed = moved
      ? placeMovedPanel(moved, viewport())
      : placePanel(anchor, viewport());
    const style = {
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      "--lingo-card-max-height": `${placed.maxHeight}px`,
    } as CSSProperties;
    return (
      <div className="lingo-panel" ref={panelElement} style={style}>
        <LookupCard
          mode={lookup.mode}
          status={lookup.status}
          text={lookup.text}
          context={lookup.context}
          error={lookup.error}
          pinned={pinned}
          onModeChange={lookUpAgain}
          onPinnedChange={setPinned}
          onDragStart={startDrag}
          onRetry={() => lookUpAgain(lookup.mode)}
          onOpenSettings={openSettings}
          onClose={close}
        />
      </div>
    );
  }
}
