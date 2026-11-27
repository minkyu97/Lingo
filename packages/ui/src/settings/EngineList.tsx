import { ChevronRight, GripVertical } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import { Icon } from "../controls/Icon.tsx";

export interface EngineListProps {
  engines: readonly { id: string; name: string; provider: string }[];
  onOpen: (engineId: string) => void;
  /** Called with the place an engine was moved to, counted from zero. */
  onMove: (engineId: string, toIndex: number) => void;
}

/** Every row is this tall, which is what turns a distance into a place. */
const ROW_HEIGHT = 48;

/** A row that is being dragged: which one, and how far from where it was. */
interface Drag {
  id: string;
  from: number;
  startY: number;
  offset: number;
}

/**
 * The user's engines, in an order they can change. Each row opens its
 * engine, and has a handle: dragging it moves the engine, and so do the up
 * and down arrows while the handle has the focus.
 */
export function EngineList({ engines, onOpen, onMove }: EngineListProps) {
  const [drag, setDrag] = useState<Drag>();
  /** Said aloud after a move, since the list gives no other sign of it. */
  const [announcement, setAnnouncement] = useState("");

  const last = engines.length - 1;
  const placeOf = ({ from, offset }: Drag) =>
    Math.min(last, Math.max(0, from + Math.round(offset / ROW_HEIGHT)));

  const move = (id: string, name: string, to: number) => {
    onMove(id, to);
    setAnnouncement(`${name} is now ${to + 1} of ${engines.length}.`);
  };

  const startDrag = (event: PointerEvent, id: string, from: number) => {
    // The handle keeps getting the pointer wherever it goes.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id, from, startY: event.clientY, offset: 0 });
  };
  const followDrag = (event: PointerEvent) => {
    if (drag) setDrag({ ...drag, offset: event.clientY - drag.startY });
  };
  const endDrag = (name: string) => {
    if (!drag) return;
    const to = placeOf(drag);
    if (to !== drag.from) move(drag.id, name, to);
    setDrag(undefined);
  };

  const onHandleKey = (
    event: KeyboardEvent,
    id: string,
    name: string,
    index: number,
  ) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    const to = index + (step ?? 0);
    if (!step || to < 0 || to > last) return;
    event.preventDefault();
    move(id, name, to);
  };

  const to = drag ? placeOf(drag) : undefined;
  const dragged = engines.find((engine) => engine.id === drag?.id);
  // The line sits above the row that the engine will come before, or below
  // the last row.
  const lineAt =
    drag && to !== undefined ? (to > drag.from ? to + 1 : to) : undefined;

  return (
    <div className="lingo-engine-list">
      <ul>
        {engines.map((engine, index) => (
          <li
            key={engine.id}
            className="lingo-engine-row"
            data-dragging={engine.id === drag?.id}
          >
            <button
              type="button"
              className="lingo-engine-row__handle"
              aria-label={`Move ${engine.name}`}
              aria-describedby="lingo-engine-list-hint"
              onPointerDown={(event) => startDrag(event, engine.id, index)}
              onPointerMove={followDrag}
              onPointerUp={() => endDrag(engine.name)}
              onPointerCancel={() => setDrag(undefined)}
              onKeyDown={(event) =>
                onHandleKey(event, engine.id, engine.name, index)
              }
            >
              <Icon icon={GripVertical} size={20} />
            </button>
            <button
              type="button"
              className="lingo-engine-row__open"
              onClick={() => onOpen(engine.id)}
            >
              <Row name={engine.name} provider={engine.provider} />
            </button>
          </li>
        ))}
      </ul>
      {drag && dragged && lineAt !== undefined && (
        <>
          <div
            className="lingo-engine-list__line"
            style={{ top: lineAt * ROW_HEIGHT }}
          />
          <div
            className="lingo-engine-list__lifted"
            style={{ top: drag.from * ROW_HEIGHT + drag.offset }}
          >
            <span className="lingo-engine-row__handle">
              <Icon icon={GripVertical} size={20} />
            </span>
            <span className="lingo-engine-row__open">
              <Row name={dragged.name} provider={dragged.provider} />
            </span>
          </div>
        </>
      )}
      <p id="lingo-engine-list-hint" hidden>
        Drag to change the order, or use the up and down arrow keys.
      </p>
      <p className="lingo-visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}

function Row({ name, provider }: { name: string; provider: string }) {
  return (
    <>
      <span className="lingo-settings-row__label">{name}</span>
      <span className="lingo-settings-row__value">{provider}</span>
      <span className="lingo-settings-row__trailing">
        <Icon icon={ChevronRight} />
      </span>
    </>
  );
}
