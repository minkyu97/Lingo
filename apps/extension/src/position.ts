export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Gap kept between floating UI and the edges of the viewport, in px. */
const MARGIN = 8;

export const TRIGGER_SIZE: Size = { width: 28, height: 28 };

/** Width of the card and the height reserved for it when choosing a side. */
export const PANEL_SIZE: Size = { width: 360, height: 300 };

/** Puts the trigger button just below and to the right of the pointer. */
export function placeTrigger(pointer: Point, viewport: Size): Point {
  return clampInto(
    { x: pointer.x + 6, y: pointer.y + 10 },
    TRIGGER_SIZE,
    viewport,
  );
}

/**
 * Puts the panel below the anchor point, or above it when there is not
 * enough room below.
 */
export function placePanel(anchor: Point, viewport: Size): Point {
  const fitsBelow = anchor.y + PANEL_SIZE.height + MARGIN <= viewport.height;
  const y = fitsBelow ? anchor.y : anchor.y - PANEL_SIZE.height - 24;
  return clampInto({ x: anchor.x, y }, PANEL_SIZE, viewport);
}

function clampInto(point: Point, size: Size, viewport: Size): Point {
  return {
    x: clamp(point.x, MARGIN, viewport.width - size.width - MARGIN),
    y: clamp(point.y, MARGIN, viewport.height - size.height - MARGIN),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
