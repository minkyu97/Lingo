import { describe, expect, it } from "vitest";
import {
  PANEL_SIZE,
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
  it("opens below the anchor when there is room", () => {
    expect(placePanel({ x: 300, y: 200 }, viewport)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("opens above the anchor near the bottom of the viewport", () => {
    const placed = placePanel({ x: 300, y: 700 }, viewport);
    expect(placed.y + PANEL_SIZE.height).toBeLessThan(700);
  });

  it("stays inside the viewport horizontally", () => {
    const placed = placePanel({ x: 1150, y: 200 }, viewport);
    expect(placed.x + PANEL_SIZE.width).toBeLessThanOrEqual(viewport.width);
  });

  it("stays on screen in a viewport smaller than the panel", () => {
    const placed = placePanel({ x: 10, y: 10 }, { width: 300, height: 200 });
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.y).toBeGreaterThanOrEqual(0);
  });
});
