/**
 * What the end-to-end specs share: a browser with the built extension loaded,
 * and the steps a user takes in it. The specs drive the extension against the
 * fake LLM server in `fake-llm-server.ts`.
 */
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";

export const SERVER = "http://127.0.0.1:43117";
const EXTENSION = fileURLToPath(
  new URL("../.output/chrome-mv3-e2e", import.meta.url),
);

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  /** Empties the fake server's record of requests before each test. */
  forgetRequests: undefined;
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
  context: async ({}, use) => {
    // Extensions need a persistent context, and only the bundled Chromium
    // still loads unpacked ones from the command line.
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
      ],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
  forgetRequests: [
    async ({ request }, use) => {
      await request.delete(`${SERVER}/requests`);
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };

/** The part of the extension API that specs call inside the service worker. */
export interface TabsApi {
  query(filter: object): Promise<{ id?: number }[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface RecordedRequest {
  path: string;
  body: {
    model: string;
    system?: string;
    instructions?: string;
    fallbacks?: string;
    messages?: { role: string; content: string }[];
    input?: { role: string; content: string }[];
    /** Anthropic's place for a JSON schema. */
    output_config?: { format?: { type: string } };
    /** OpenAI's place for a JSON schema. */
    text?: { format?: { type: string; name: string } };
  };
}

export async function recordedRequests(page: Page): Promise<RecordedRequest[]> {
  return (await page.request.get(`${SERVER}/requests`)).json();
}

/** What a test changes in the settings before it looks something up. */
export interface Setup {
  /** The provider to switch to. Anthropic is the default. */
  provider?: "OpenAI";
  apiKey: string;
  /** The English name of the language to translate into. */
  language?: string;
  /** `false` turns context awareness off. */
  context?: false;
}

/**
 * Opens the settings page and changes the settings the way a user would.
 * There is no Save button: each change is stored as it is made.
 */
export async function setUp(
  context: BrowserContext,
  extensionId: string,
  setup: Setup,
) {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const row = (name: string) =>
    settings.getByRole("button", { name: new RegExp(`^${name}`) });
  const back = () => settings.getByRole("button", { name: "Back" }).click();

  await row("Translation engine").click();
  if (setup.provider) {
    await settings
      .getByRole("button", { name: setup.provider, exact: true })
      .click();
  }
  await settings.getByLabel("API key").fill(setup.apiKey);
  await settings.getByLabel("API key").press("Enter");
  await expect(settings.getByText(/^Saved\./)).toBeVisible();
  await back();

  if (setup.language) {
    await row("Translate into").click();
    await settings
      .getByRole("radio", { name: new RegExp(setup.language) })
      .check();
    await back();
  }
  if (setup.context === false) {
    await row("Context").click();
    await settings.getByRole("switch").click();
    await back();
    await expect(row("Context")).toContainText("Off");
  }
  return settings;
}

export const trigger = (page: Page) =>
  page.getByRole("button", { name: "Look up with Lingo" });

/**
 * Selects one word of the test page the way a user would, by double-clicking
 * it. Resolves once the Lingo button has appeared.
 */
export async function selectWord(page: Page, word: string) {
  const box = await page.evaluate((target) => {
    const node = document.querySelector("#text")?.firstChild as Text;
    const start = node.data.indexOf(target);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + target.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, word);

  // The host element is attached a moment before its listeners are.
  await expect(async () => {
    await page.mouse.dblclick(box.x, box.y);
    await expect(trigger(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(word);
}

/** Opens the test page and selects one word on it. */
export async function openPageAndSelect(context: BrowserContext, word: string) {
  const page = await context.newPage();
  await page.goto(`${SERVER}/page`);
  // The content script mounts after the page has loaded.
  await page.locator("lingo-ui").waitFor({ state: "attached" });
  await selectWord(page, word);
  return page;
}

export const panel = (page: Page) =>
  page.getByRole("region", { name: "Lingo lookup" });

/** Waits until the panel shows a finished dictionary entry. */
export async function expectFinishedEntry(page: Page) {
  await expect(panel(page).getByText("In this context")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Copy" })).toBeVisible();
}
