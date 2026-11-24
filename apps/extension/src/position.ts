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

/** Width of the lookup card. */
export const PANEL_WIDTH = 360;

/** The tallest the panel gets when the viewport has room for it. */
export const PANEL_MAX_HEIGHT = 440;

/** The shortest the panel is squeezed to in a small viewport. */
export const PANEL_MIN_HEIGHT = 160;

/**
 * How far above the anchor the bottom of the panel sits when it opens upward,
 * so that it clears the line of text the selection is on.
 */
const ABOVE_GAP = 36;

/** Puts the trigger button just below and to the right of the pointer. */
export function placeTrigger(pointer: Point, viewport: Size): Point {
  return {
    x: clamp(
      pointer.x + 6,
      MARGIN,
      viewport.width - TRIGGER_SIZE.width - MARGIN,
    ),
    y: clamp(
      pointer.y + 10,
      MARGIN,
      viewport.height - TRIGGER_SIZE.height - MARGIN,
    ),
  };
}

export interface PanelPlacement {
  left: number;
  /** Set when the panel hangs down from the anchor. */
  top?: number;
  /**
   * Set when the panel stands on the anchor instead: the distance from the
   * bottom of the viewport to the bottom of the panel.
   */
  bottom?: number;
  /** How tall the panel may grow before its content scrolls. */
  maxHeight: number;
}

/**
 * Places the panel below the anchor point, or above it when there is more
 * room there. The panel's height depends on the answer, so it is pinned by
 * the edge nearest the selection and limited to the room on that side.
 */
export function placePanel(anchor: Point, viewport: Size): PanelPlacement {
  const left = clamp(anchor.x, MARGIN, viewport.width - PANEL_WIDTH - MARGIN);
  const roomBelow = viewport.height - anchor.y - MARGIN;
  const roomAbove = anchor.y - ABOVE_GAP - MARGIN;

  if (roomBelow >= PANEL_MAX_HEIGHT || roomBelow >= roomAbove) {
    const maxHeight = clamp(roomBelow, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT);
    // In a viewport shorter than the minimum, move up to stay on screen.
    const top = clamp(anchor.y, MARGIN, viewport.height - maxHeight - MARGIN);
    return { left, top, maxHeight };
  }

  return {
    left,
    bottom: viewport.height - anchor.y + ABOVE_GAP,
    maxHeight: clamp(roomAbove, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT),
  };
}

/**
 * Places the panel where the user dragged it: `corner` is where its top-left
 * corner was dropped. The panel is kept inside the viewport, with room below
 * it for at least its shortest height.
 */
export function placeMovedPanel(corner: Point, viewport: Size): PanelPlacement {
  const left = clamp(corner.x, MARGIN, viewport.width - PANEL_WIDTH - MARGIN);
  const top = clamp(
    corner.y,
    MARGIN,
    viewport.height - PANEL_MIN_HEIGHT - MARGIN,
  );
  const roomBelow = viewport.height - top - MARGIN;
  return {
    left,
    top,
    maxHeight: clamp(roomBelow, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT),
  };
}

/** Clamps to a range. The lower bound wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
