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
        // Lets a test press the toolbar button and reload the extension.
        "--enable-unsafe-extension-debugging",
      ],
    });
    // A new install opens the settings in a tab, at a moment of its own
    // choosing. Close it, so that a test decides which tab is in front.
    const isSettings = (page: Page) => page.url().includes("options.html");
    await expect
      .poll(() => context.pages().some(isSettings), { timeout: 15_000 })
      .toBe(true);
    await context.pages().find(isSettings)?.close();
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

interface ActionApi {
  onClicked: { hasListeners(): boolean };
}

/** A session with the browser itself, for what no page can be asked to do. */
async function browserSession(context: BrowserContext) {
  const browser = context.browser();
  if (!browser) throw new Error("The context has no browser");
  return browser.newBrowserCDPSession();
}

/**
 * Presses the extension's toolbar button while `page` is the tab in front.
 * The browser treats this as a real press, with the access that a press
 * grants to the tab.
 */
export async function pressToolbarButton(page: Page, extensionId: string) {
  await page.bringToFront();
  const session = await browserSession(page.context());
  const { targetInfos } = await session.send("Target.getTargets", {
    filter: [{ type: "tab" }],
  });
  const tabs = targetInfos.filter((target) => target.url === page.url());
  const [tab] = tabs;
  if (!tab || tabs.length > 1) {
    throw new Error(`Expected one tab at ${page.url()}, found ${tabs.length}`);
  }
  await session.send("Extensions.triggerAction", {
    id: extensionId,
    targetId: tab.targetId,
  });
  await session.detach();
}

/**
 * Loads the extension again, as an update does, or a press of Reload on the
 * extensions page. The content scripts in open tabs are cut off from it, like
 * those of tabs that were open before the extension was installed.
 */
export async function reloadExtension(context: BrowserContext) {
  const session = await browserSession(context);
  const restarted = context.waitForEvent("serviceworker");
  await session.send("Extensions.loadUnpacked", { path: EXTENSION });
  const worker = await restarted;
  await session.detach();
  // A press of the toolbar button is lost until the new service worker has
  // said that it listens for one.
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (
          globalThis as unknown as { chrome: { action: ActionApi } }
        ).chrome.action.onClicked.hasListeners(),
      ),
    )
    .toBe(true);
}

/**
 * Waits until the extension answers messages in `page`. Its element is in
 * the page a moment before its listeners are attached.
 */
export async function waitUntilListening(page: Page, worker: Worker) {
  await page.bringToFront();
  await expect(async () => {
    await worker.evaluate(async () => {
      const { tabs } = (globalThis as unknown as { chrome: { tabs: TabsApi } })
        .chrome;
      const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) throw new Error("No tab is in front");
      // Does nothing without a selection, and fails when nobody listens.
      await tabs.sendMessage(tab.id, { type: "lookup-selection" });
    });
  }).toPass({ timeout: 10_000 });
}

/** The settings as they show inside a page: an extension page in an iframe. */
export const drawer = (page: Page) =>
  page.frameLocator('iframe[title="Lingo settings"]');

/** The element that holds the drawer, which is there only while it is open. */
export const drawerFrame = (page: Page) =>
  page.locator('iframe[title="Lingo settings"]');

/** Opens the test page and waits until the extension is running in it. */
export async function openTestPage(context: BrowserContext, path = "/page") {
  const page = await context.newPage();
  await page.goto(`${SERVER}${path}`);
  // The content script mounts after the page has loaded.
  await page.locator("lingo-ui").waitFor({ state: "attached" });
  return page;
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
  const page = await openTestPage(context);
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
