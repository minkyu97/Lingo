import type { PointerEvent as ReactPointerEvent } from "react";
import type { Point } from "./position.ts";

/**
 * Follows the pointer from the press in `event` until it is released. Each
 * time the pointer moves, `onMove` is told where the top-left corner of
 * `element` has to be for it to stay under the pointer the way it was
 * grabbed.
 */
export function followPointer(
  event: ReactPointerEvent<HTMLElement>,
  element: Element,
  onMove: (corner: Point) => void,
): void {
  const handle = event.currentTarget;
  const box = element.getBoundingClientRect();
  const grip = { x: event.clientX - box.left, y: event.clientY - box.top };

  const move = (moved: PointerEvent) =>
    onMove({ x: moved.clientX - grip.x, y: moved.clientY - grip.y });
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
  };

  // With the pointer captured, the handle keeps getting its events even when
  // the pointer leaves it, or leaves the window.
  handle.setPointerCapture(event.pointerId);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);

  // Keeps the page's selection, and stops the drag from selecting text.
  event.preventDefault();
}
