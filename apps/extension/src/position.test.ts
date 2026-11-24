import { describe, expect, it } from "vitest";
import {
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_WIDTH,
  placeMovedPanel,
  placePanel,
  placeTrigger,
  TRIGGER_SIZE,
} from "./position.ts";

const viewport = { width: 1200, height: 800 };

describe("placeTrigger", () => {
  it("sits just below and right of the pointer", () => {
    expect(placeTrigger({ x: 300, y: 200 }, viewport)).toEqual({
      x: 306,
      y: 210,
    });
  });

  it("stays inside the viewport at the edges", () => {
    const corner = placeTrigger({ x: 1199, y: 799 }, viewport);
    expect(corner.x + TRIGGER_SIZE.width).toBeLessThanOrEqual(viewport.width);
    expect(corner.y + TRIGGER_SIZE.height).toBeLessThanOrEqual(viewport.height);

    const origin = placeTrigger({ x: -50, y: -50 }, viewport);
    expect(origin.x).toBeGreaterThanOrEqual(0);
    expect(origin.y).toBeGreaterThanOrEqual(0);
  });
});

describe("placePanel", () => {
  it("hangs below the anchor at full height when there is room", () => {
    expect(placePanel({ x: 300, y: 200 }, viewport)).toEqual({
      left: 300,
      top: 200,
      maxHeight: PANEL_MAX_HEIGHT,
    });
  });

  it("stands above the anchor near the bottom of the viewport", () => {
    const placed = placePanel({ x: 300, y: 700 }, viewport);
    expect(placed.top).toBeUndefined();
    // The bottom edge of the panel ends up above the anchor.
    const bottomEdge = viewport.height - (placed.bottom ?? 0);
    expect(bottomEdge).toBeLessThan(700);
    expect(placed.maxHeight).toBe(PANEL_MAX_HEIGHT);
  });

  it("limits its height to the room on the side it opens to", () => {
    // 380px below and less above: opens down, but shorter than the maximum.
    const down = placePanel({ x: 300, y: 412 }, viewport);
    expect(down.top).toBe(412);
    expect(down.maxHeight).toBe(380);

    // 300px above, 90px below: opens up into the 300px.
    const up = placePanel({ x: 300, y: 344 }, { width: 1200, height: 442 });
    expect(up.bottom).toBeDefined();
    expect(up.maxHeight).toBe(300);
  });

  it("never reaches past the viewport when it opens down", () => {
    for (const y of [0, 100, 300, 359]) {
      const placed = placePanel({ x: 300, y }, viewport);
      expect((placed.top ?? 0) + placed.maxHeight).toBeLessThanOrEqual(
        viewport.height,
      );
    }
  });

  it("stays inside the viewport horizontally", () => {
    const placed = placePanel({ x: 1150, y: 200 }, viewport);
    expect(placed.left + PANEL_WIDTH).toBeLessThanOrEqual(viewport.width);
    expect(placePanel({ x: -40, y: 200 }, viewport).left).toBeGreaterThan(0);
  });

  it("keeps a usable height in a very small viewport", () => {
    const placed = placePanel({ x: 10, y: 60 }, { width: 300, height: 180 });
    expect(placed.maxHeight).toBe(PANEL_MIN_HEIGHT);
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.top).toBeGreaterThanOrEqual(0);
  });
});

describe("placeMovedPanel", () => {
  it("puts the corner of the panel where it was dropped", () => {
    expect(placeMovedPanel({ x: 300, y: 120 }, viewport)).toEqual({
      left: 300,
      top: 120,
      maxHeight: PANEL_MAX_HEIGHT,
    });
  });

  it("gives the panel only the room that is left below it", () => {
    const placed = placeMovedPanel({ x: 300, y: 500 }, viewport);
    expect(placed.top).toBe(500);
    expect(placed.maxHeight).toBe(viewport.height - 500 - 8);
  });

  it("keeps the panel inside the viewport", () => {
    const beyond = placeMovedPanel({ x: 5000, y: 5000 }, viewport);
    expect(beyond.left + PANEL_WIDTH).toBeLessThanOrEqual(viewport.width);
    expect(beyond.top).toBe(viewport.height - PANEL_MIN_HEIGHT - 8);
    expect(beyond.maxHeight).toBe(PANEL_MIN_HEIGHT);

    const before = placeMovedPanel({ x: -200, y: -200 }, viewport);
    expect(before.left).toBe(8);
    expect(before.top).toBe(8);
  });
});
