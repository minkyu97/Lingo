import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_CHARS,
  MAX_BATCH_SEGMENTS,
  pageTranslationOptionsSchema,
  parsePageRequest,
} from "./protocol.ts";

describe("parsePageRequest", () => {
  it("reads a request for a permit", () => {
    expect(parsePageRequest({ type: "permit" })).toEqual({ type: "permit" });
  });

  it("reads a request to translate segments", () => {
    const request = {
      type: "translate",
      batch: 3,
      title: "Title",
      segments: [{ id: 1, text: "Hello" }],
    };
    expect(parsePageRequest(request)).toEqual(request);
  });

  it("drops a title that is not usable, and keeps the request", () => {
    const request = {
      type: "translate",
      batch: 3,
      title: "x".repeat(301),
      segments: [{ id: 1, text: "Hello" }],
    };
    expect(parsePageRequest(request)).toEqual({ ...request, title: undefined });
  });

  it("refuses requests that are too large", () => {
    const segment = (id: number, text = "a") => ({ id, text });
    const tooMany = Array.from({ length: MAX_BATCH_SEGMENTS + 1 }, (_, id) =>
      segment(id),
    );
    const tooLong = [segment(1, "a".repeat(MAX_BATCH_CHARS + 1))];
    expect(
      parsePageRequest({ type: "translate", batch: 1, segments: tooMany }),
    ).toBeUndefined();
    expect(
      parsePageRequest({ type: "translate", batch: 1, segments: tooLong }),
    ).toBeUndefined();
  });

  it("refuses anything else", () => {
    expect(parsePageRequest(undefined)).toBeUndefined();
    expect(parsePageRequest({ type: "start" })).toBeUndefined();
    expect(
      parsePageRequest({ type: "translate", batch: 1, segments: [] }),
    ).toBeUndefined();
    expect(
      parsePageRequest({
        type: "translate",
        batch: 1,
        segments: [{ id: 1, text: "" }],
      }),
    ).toBeUndefined();
  });
});

describe("pageTranslationOptionsSchema", () => {
  const defaults = {
    requestsPerSecond: 3,
    aheadViewports: 1,
    batchChars: 1500,
  };

  it("falls back to the defaults for what is missing", () => {
    expect(pageTranslationOptionsSchema.parse({})).toEqual(defaults);
    expect(pageTranslationOptionsSchema.parse(undefined)).toEqual(defaults);
    expect(pageTranslationOptionsSchema.parse("nonsense")).toEqual(defaults);
  });

  it("keeps valid values and replaces invalid ones", () => {
    expect(
      pageTranslationOptionsSchema.parse({
        requestsPerSecond: 10,
        aheadViewports: 99,
        batchChars: 400,
      }),
    ).toEqual({ ...defaults, requestsPerSecond: 10, batchChars: 400 });
    expect(
      pageTranslationOptionsSchema.parse({ requestsPerSecond: 0 }),
    ).toEqual(defaults);
    expect(
      pageTranslationOptionsSchema.parse({ requestsPerSecond: 2.5 }),
    ).toEqual(defaults);
  });
});
