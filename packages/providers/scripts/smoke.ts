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
import {
  type CapturedContext,
  type ChatRequest,
  LLMError,
  PROVIDER_IDS,
  type ProviderId,
  parseDictionaryEntry,
  prepareLookup,
} from "@lingo/core";
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

const captured: CapturedContext = {
  selection: "bank",
  level: "paragraph",
  before: "She sat on the river ",
  after: " and watched the boats.",
};
const settings = {
  targetLanguage: "ko",
  contextAwareness: true,
  maxContextChars: 1000,
};
const translate = prepareLookup("translate", captured, settings).request;
/** Asks for a dictionary entry as JSON held to a schema. */
const define = prepareLookup("define", captured, settings).request;

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

interface Streamed {
  text: string;
  timing: string;
}

async function stream(
  provider: ProviderId,
  apiKey: string,
  model: string,
  request: ChatRequest,
): Promise<Streamed> {
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
  return { text, timing: `first chunk ${firstMs} ms, total ${totalMs} ms` };
}

async function translateOnce(
  provider: ProviderId,
  apiKey: string,
  model: string,
): Promise<void> {
  const { text, timing } = await stream(provider, apiKey, model, translate);
  console.log(
    `  ok    ${model} translate: ${JSON.stringify(text)} (${timing})`,
  );
}

/** A definition must come back as a complete dictionary entry. */
async function defineOnce(
  provider: ProviderId,
  apiKey: string,
  model: string,
): Promise<void> {
  const { text, timing } = await stream(provider, apiKey, model, define);
  JSON.parse(text);
  const entry = parseDictionaryEntry(text);
  if (!entry?.headword) throw new Error(`no headword in ${text}`);
  if (!entry.contextMeaning) throw new Error(`no context meaning in ${text}`);
  const complete = entry.senses.filter(
    (sense) => sense.partOfSpeech && sense.meaning && sense.example,
  );
  if (complete.length === 0 || complete.length !== entry.senses.length) {
    throw new Error(`incomplete senses in ${text}`);
  }
  if (!entry.senses.some((sense) => sense.inContext)) {
    throw new Error(`no sense is marked as the one in context in ${text}`);
  }

  console.log(`  ok    ${model} define (${timing}):`);
  console.log(`          ${entry.headword} ${entry.pronunciation}`);
  console.log(`          in context: ${entry.contextMeaning}`);
  for (const sense of entry.senses) {
    const mark = sense.inContext ? " *" : "";
    console.log(
      `          [${sense.partOfSpeech}] ${sense.meaning}${mark} | ${sense.example} / ${sense.exampleTranslation}`,
    );
  }
}

/** The key check must pass a real key and turn down a made-up one. */
async function checkKeys(provider: ProviderId, apiKey: string): Promise<void> {
  const models = await createProvider({
    provider,
    apiKey,
    fetch: fetchWithOrigin,
  }).listModels();
  console.log(`  ok    the real key lists ${models.length} models`);
  for (const model of STREAMED_MODELS[provider]) {
    if (!models.some(({ id }) => id === model)) {
      throw new Error(`the list lacks ${model}`);
    }
  }
  console.log("  ok    the list has the models that are streamed below");

  const rejection = await createProvider({
    provider,
    apiKey: "lingo-smoke-check-not-a-key",
    fetch: fetchWithOrigin,
  })
    .listModels()
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!(rejection instanceof LLMError) || rejection.kind !== "auth") {
    throw new Error(`a made-up key was not rejected: ${String(rejection)}`);
  }
  console.log("  ok    a made-up key is rejected");
}

for (const provider of PROVIDER_IDS) {
  const apiKey = process.env[KEY_VARIABLES[provider]];
  console.log(`\n${PROVIDERS[provider].label}`);
  if (!apiKey) {
    console.log(`  skip  ${KEY_VARIABLES[provider]} is not set`);
    continue;
  }

  try {
    await checkKeys(provider, apiKey);
  } catch (error) {
    fail("key check", error);
  }

  for (const model of STREAMED_MODELS[provider]) {
    try {
      await translateOnce(provider, apiKey, model);
    } catch (error) {
      fail(`translate with ${model}`, error);
    }
    try {
      await defineOnce(provider, apiKey, model);
    } catch (error) {
      fail(`define with ${model}`, error);
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} failed.`);
process.exitCode = failures === 0 ? 0 : 1;
