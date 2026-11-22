/**
 * Live check of the adapters against the real provider APIs.
 *
 * It needs your own API keys and costs a few cents per run, so it is run by
 * hand and never in CI:
 *
 *   pnpm smoke
 *
 * Keys are read from ANTHROPIC_API_KEY and OPENAI_API_KEY, in the environment
 * or in `.env.local` at the repo root. A provider without a key is skipped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_IDS, type ProviderId, prepareLookup } from "@lingo/core";
import OpenAI from "openai";
import { createProvider, PROVIDERS } from "../src/index.ts";

const KEY_VARIABLES: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Models that get a real streamed request: each provider's default, plus one
 * that takes a different request path in the adapter.
 */
const STREAMED_MODELS: Record<ProviderId, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-haiku-5-5"],
  openai: ["gpt-6.2-sol", "gpt-6-luna"],
};

const { request } = prepareLookup(
  "translate",
  {
    selection: "bank",
    level: "paragraph",
    before: "She sat on the river ",
    after: " and watched the boats.",
  },
  { targetLanguage: "ko", contextAwareness: true, maxContextChars: 1000 },
);

/** Sends requests the way the extension's service worker does: with an Origin. */
const fetchWithOrigin: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("origin", "chrome-extension://lingo-smoke-check");
  return fetch(input, { ...init, headers });
};

let failures = 0;

function fail(label: string, error: unknown): void {
  failures += 1;
  const reason = error instanceof Error ? error.message : String(error);
  console.log(`  FAIL  ${label}: ${reason}`);
}

async function modelExists(
  provider: ProviderId,
  apiKey: string,
  model: string,
): Promise<void> {
  if (provider === "anthropic") {
    await new Anthropic({ apiKey }).models.retrieve(model);
  } else {
    await new OpenAI({ apiKey }).models.retrieve(model);
  }
}

async function streamOnce(
  provider: ProviderId,
  apiKey: string,
  model: string,
): Promise<void> {
  const started = performance.now();
  let firstChunkAt: number | undefined;
  let text = "";
  const llm = createProvider({
    provider,
    apiKey,
    model,
    fetch: fetchWithOrigin,
  });
  for await (const chunk of llm.stream(request)) {
    firstChunkAt ??= performance.now();
    text += chunk;
  }
  if (text.trim() === "") throw new Error("the stream produced no text");

  const firstMs = Math.round((firstChunkAt ?? started) - started);
  const totalMs = Math.round(performance.now() - started);
  console.log(
    `  ok    ${model}: ${JSON.stringify(text)} (first chunk ${firstMs} ms, total ${totalMs} ms)`,
  );
}

for (const provider of PROVIDER_IDS) {
  const apiKey = process.env[KEY_VARIABLES[provider]];
  console.log(`\n${PROVIDERS[provider].label}`);
  if (!apiKey) {
    console.log(`  skip  ${KEY_VARIABLES[provider]} is not set`);
    continue;
  }

  for (const { id } of PROVIDERS[provider].models) {
    try {
      await modelExists(provider, apiKey, id);
      console.log(`  ok    model ${id} exists`);
    } catch (error) {
      fail(`model ${id}`, error);
    }
  }

  for (const model of STREAMED_MODELS[provider]) {
    try {
      await streamOnce(provider, apiKey, model);
    } catch (error) {
      fail(`stream ${model}`, error);
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} failed.`);
process.exitCode = failures === 0 ? 0 : 1;
