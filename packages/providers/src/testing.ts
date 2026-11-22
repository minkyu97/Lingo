import { readFileSync } from "node:fs";
import type { ChatRequest, LLMProvider } from "@lingo/core";

/** Reads a recorded provider response from `spec/fixtures`. */
export function fixture(name: string): string {
  const url = new URL(`../../../spec/fixtures/${name}`, import.meta.url);
  return readFileSync(url, "utf8");
}

export interface RecordedCall {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A `fetch` stand-in that answers every call with `respond` and records it. */
export function fakeFetch(respond: () => Response) {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      headers: request.headers,
      body: JSON.parse(await request.text()),
    });
    return respond();
  };
  return { fetch, calls };
}

export function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function collect(
  provider: LLMProvider,
  request: ChatRequest,
): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of provider.stream(request)) chunks.push(chunk);
  return chunks;
}

export const sampleRequest: ChatRequest = {
  system: "You are a translator.",
  messages: [{ role: "user", content: "<selection>Hello</selection>" }],
};
