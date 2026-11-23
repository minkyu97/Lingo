import { describe, expect, it } from "vitest";
import { chooseMode } from "./mode.ts";

describe("chooseMode", () => {
  it.each([
    "serendipity",
    "  bank  ",
    "take off",
    "in spite of",
    "배",
    "図書館",
  ])("defines a word or short phrase: %j", (selection) => {
    expect(chooseMode(selection)).toBe("define");
  });

  it.each([
    "She sat on the river bank.",
    "one two three four",
    "Really?",
    "First line\nSecond line",
    "아침에 배를 타고 섬으로 갔다",
    "私は図書館で本を読みました",
    "",
    "   ",
  ])("translates anything longer: %j", (selection) => {
    expect(chooseMode(selection)).toBe("translate");
  });
});
