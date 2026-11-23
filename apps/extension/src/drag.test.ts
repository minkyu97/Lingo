import type { PointerEvent as ReactPointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { followPointer } from "./drag.ts";

/** A card at (100, 50) with a handle inside it, pressed at (130, 60). */
function press() {
  const card = document.createElement("div");
  const handle = document.createElement("header");
  card.append(handle);
  card.getBoundingClientRect = () => new DOMRect(100, 50, 360, 200);
  // jsdom has no pointer capture.
  handle.setPointerCapture = vi.fn();

  const preventDefault = vi.fn();
  const event = {
    currentTarget: handle,
    pointerId: 7,
    clientX: 130,
    clientY: 60,
    preventDefault,
  } as unknown as ReactPointerEvent<HTMLElement>;
  const onMove = vi.fn();
  followPointer(event, card, onMove);
  return { handle, onMove, preventDefault };
}

function pointer(type: string, clientX = 0, clientY = 0) {
  return new MouseEvent(type, { clientX, clientY });
}

describe("followPointer", () => {
  it("captures the pointer and leaves the page's selection alone", () => {
    const { handle, preventDefault } = press();
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("keeps the card under the pointer the way it was grabbed", () => {
    const { handle, onMove } = press();

    handle.dispatchEvent(pointer("pointermove", 330, 160));
    // The pointer went 200 right and 100 down, and so does the corner.
    expect(onMove).toHaveBeenLastCalledWith({ x: 300, y: 150 });
  });

  it("stops following once the pointer is released", () => {
    for (const release of ["pointerup", "pointercancel"]) {
      const { handle, onMove } = press();
      handle.dispatchEvent(pointer(release));
      handle.dispatchEvent(pointer("pointermove", 500, 500));
      expect(onMove).not.toHaveBeenCalled();
    }
  });
});
