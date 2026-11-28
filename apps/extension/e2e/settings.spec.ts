/** Changing the settings, and what the extension does with the changes. */
import type { Page } from "@playwright/test";
import {
  addEngine,
  drawer,
  drawerFrame,
  expect,
  openTestPage,
  pressToolbarButton,
  reloadExtension,
  test,
  waitUntilListening,
} from "./extension.ts";

/**
 * Waits until the drawer has slid in: a panel on the right edge of the page,
 * as tall as the viewport. The frame is 1px narrower than the panel, which
 * has a border on its left.
 */
async function expectDocked(page: Page) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  await expect
    .poll(() => drawerFrame(page).boundingBox())
    .toEqual({
      x: viewport.width - 359,
      y: 0,
      width: 359,
      height: viewport.height,
    });
}

/** The name of the next animation to end in what the extension draws. */
function nextAnimationToEnd(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const drawn = document.querySelector("lingo-ui")?.shadowRoot;
        drawn?.addEventListener(
          "animationend",
          (event) => resolve((event as AnimationEvent).animationName),
          { once: true },
        );
      }),
  );
}

test("opens inside the page when the toolbar button is pressed", async ({
  context,
  extensionId,
  worker,
}, testInfo) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  const tabs = context.pages().length;

  await pressToolbarButton(page, extensionId);
  await expect(
    drawer(page).getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  // In the page, not in a tab of its own.
  expect(context.pages()).toHaveLength(tabs);
  await expectDocked(page);
  await page.screenshot({ path: testInfo.outputPath("drawer.png") });

  // An engine added here has its key checked and stored like anywhere else, although
  // this frame sits inside a web page.
  await drawer(page)
    .getByRole("button", { name: /^Translation engines/ })
    .click();
  await addEngine(drawer(page), { apiKey: "test-key" });
  await drawer(page).getByRole("button", { name: "Back" }).click();
  await expect(
    drawer(page).getByRole("button", { name: /^Translation engines/ }),
  ).toContainText("1 engine");

  // It leaves the way it came: sliding, and then it is off the page.
  const leaving = nextAnimationToEnd(page);
  await drawer(page).getByRole("button", { name: "Close" }).click();
  expect(await leaving).toBe("lingo-drawer-out");
  await expect(drawerFrame(page)).toHaveCount(0);
});

test("closes on a second press and on Escape", async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  const heading = drawer(page).getByRole("heading", { name: "Settings" });

  await pressToolbarButton(page, extensionId);
  await expect(heading).toBeVisible();
  await pressToolbarButton(page, extensionId);
  await expect(drawerFrame(page)).toHaveCount(0);

  // Escape, with the keyboard inside the drawer.
  await pressToolbarButton(page, extensionId);
  await expect(heading).toBeVisible();
  await heading.click();
  await page.keyboard.press("Escape");
  await expect(drawerFrame(page)).toHaveCount(0);

  // Escape, with the keyboard in the page.
  await pressToolbarButton(page, extensionId);
  await expect(heading).toBeVisible();
  await page.locator("h1").click();
  await page.keyboard.press("Escape");
  await expect(drawerFrame(page)).toHaveCount(0);
});

test("opens inside a page that was open before the extension was", async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  // From here on the page is like one that was open before the extension
  // was installed: nothing in it answers the extension.
  await reloadExtension(context);

  await pressToolbarButton(page, extensionId);
  await expect(
    drawer(page).getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  // In the page, and not in a tab of its own.
  expect(context.pages().map((tab) => tab.url())).not.toContainEqual(
    expect.stringContaining("options.html"),
  );
  // The new content script has taken the place of the one that was cut off.
  await expect(page.locator("lingo-ui")).toHaveCount(1);
});

test("opens in a tab where the page cannot hold it", async ({
  context,
  extensionId,
}) => {
  // No extension may run a script in one of the browser's own pages.
  const browserPage = await context.newPage();
  await browserPage.goto("chrome://version/");
  await pressToolbarButton(browserPage, extensionId);

  const isSettings = (page: Page) => page.url().includes("options.html");
  await expect.poll(() => context.pages().some(isSettings)).toBe(true);
  const settings = context.pages().find(isSettings) ?? browserPage;
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  // A tab of its own has nothing to close.
  await expect(settings.getByRole("button", { name: "Close" })).toHaveCount(0);
});

test("opens inside a page that forbids frames", async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await openTestPage(context, "/strict-page");
  await waitUntilListening(page, worker);

  await pressToolbarButton(page, extensionId);
  await expect(
    drawer(page).getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
});

test("shows no settings in a frame the extension did not open", async ({
  context,
  extensionId,
}) => {
  const page = await openTestPage(context);
  // What a page could do to get someone to press things in the settings.
  await page.evaluate((source) => {
    const frame = document.createElement("iframe");
    frame.id = "planted";
    frame.src = source;
    document.body.append(frame);
  }, `chrome-extension://${extensionId}/settings-drawer.html`);

  const planted = page.frameLocator("#planted");
  await expect(
    planted.getByText("Open the settings of Lingo from its button"),
  ).toBeVisible();
  await expect(planted.getByText("Translation engine")).toHaveCount(0);
});

test("opens and closes at once for someone who avoids motion", async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await pressToolbarButton(page, extensionId);
  await expect(
    drawer(page).getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  await pressToolbarButton(page, extensionId);
  await expect(drawerFrame(page)).toHaveCount(0);
});

test("follows the system theme inside the drawer", async ({
  context,
  extensionId,
  worker,
}, testInfo) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  await page.emulateMedia({ colorScheme: "dark" });

  await pressToolbarButton(page, extensionId);
  const panel = drawer(page).locator(".lingo-settings");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("background-color", "rgb(31, 35, 40)");
  await expectDocked(page);
  await page.screenshot({ path: testInfo.outputPath("drawer-dark.png") });
});

test("checks a key with the provider before an engine is added", async ({
  context,
  extensionId,
}, testInfo) => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const engines = settings.getByRole("button", {
    name: /^Translation engines/,
  });
  await expect(engines).toContainText("Not set");
  await engines.click();
  await settings.getByRole("button", { name: "Add engine" }).click();
  const key = settings.getByLabel("API key");
  const add = settings.getByRole("button", { name: "Add engine" });
  const enter = async (value: string) => {
    await key.fill(value);
    await key.press("Enter");
  };

  // Before a key is in, there is no model to pick and nothing to add.
  await expect(
    settings.getByText("Enter the API key to see the models it can use."),
  ).toBeVisible();
  await expect(settings.getByRole("radio")).toHaveCount(1);
  await expect(add).toBeDisabled();

  // A key the provider refuses brings no models.
  await enter("bad-key");
  await expect(
    settings.getByText("Not stored. Anthropic rejected this key."),
  ).toBeVisible();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(add).toBeDisabled();
  await settings.screenshot({ path: testInfo.outputPath("rejected.png") });

  // Nor does one that could not be checked. The check can be tried again.
  await enter("offline-key");
  const unreachable = settings.getByText("Lingo could not reach Anthropic.");
  await expect(unreachable).toBeVisible();
  await settings.getByRole("button", { name: "Try again" }).click();
  await expect(settings.getByText(/^Checking the key/)).toBeVisible();
  await expect(unreachable).toBeVisible();

  // While the provider is being asked, the field cannot be edited.
  await enter("slow-key");
  await expect(
    settings.getByText("Checking the key with Anthropic…"),
  ).toBeVisible();
  await expect(key).toBeDisabled();
  await settings.screenshot({ path: testInfo.outputPath("checking.png") });
  await expect(
    settings.getByText("Anthropic accepted this key."),
  ).toBeVisible();
  await expect(key).toBeEnabled();

  // The models are the ones the provider lists for the key, newest first.
  await expect(settings.getByRole("radio")).toHaveCount(5);
  await expect(settings.locator(".lingo-option-row").first()).toContainText(
    "Claude Fable 5.2",
  );
  await expect(add).toBeDisabled();
  await settings.getByRole("radio", { name: "Claude Fable 5.2" }).check();
  await settings.screenshot({ path: testInfo.outputPath("accepted.png") });
  await add.click();

  await expect(
    settings.getByRole("button", { name: /^Claude Fable 5.2/ }),
  ).toContainText("Anthropic");
  await settings.screenshot({ path: testInfo.outputPath("engines.png") });
  await settings.getByRole("button", { name: "Back" }).click();
  await expect(engines).toContainText("1 engine");
});

test("keeps what was set up before there were engines", async ({
  context,
  worker,
  extensionId,
}) => {
  // Settings and a key, as an earlier version stored them.
  await worker.evaluate(async () => {
    const { storage } = (
      globalThis as unknown as {
        chrome: { storage: { local: { set(items: object): Promise<void> } } };
      }
    ).chrome;
    await storage.local.set({
      settings: {
        provider: "anthropic",
        models: { anthropic: "claude-sonnet-5-5" },
        pageModels: {},
        targetLanguage: "ko",
      },
      apiKeys: { anthropic: "test-key" },
    });
  });

  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const row = (name: RegExp) => settings.getByRole("button", { name });
  await expect(row(/^Translation engines/)).toContainText("2 engines");
  await expect(row(/^Translate into/)).toContainText("한국어");

  await row(/^Translation engines/).click();
  await expect(row(/^Translation/).first()).toContainText("Claude Sonnet 5.5");
  await expect(row(/^Definition/)).toContainText("Claude Sonnet 5.5");
  await expect(row(/^Page translation/)).toContainText("Claude Haiku 5.5");

  // The key came along.
  await row(/^Claude Haiku 5.5/).click();
  await expect(settings.getByLabel("API key")).toHaveValue("test-key");
});

test("duplicates an engine, and drags engines into another order", async ({
  context,
  worker,
  extensionId,
}, testInfo) => {
  await worker.evaluate(async () => {
    const { storage } = (
      globalThis as unknown as {
        chrome: { storage: { local: { set(items: object): Promise<void> } } };
      }
    ).chrome;
    await storage.local.set({
      settings: {
        engines: [
          {
            id: "opus",
            provider: "anthropic",
            model: "claude-opus-5-5",
            modelLabel: "Claude Opus 5.5",
            parameters: { temperature: 0.3 },
          },
        ],
      },
      engineKeys: { opus: "test-key" },
    });
  });
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByRole("button", { name: /^Translation engines/ }).click();
  const names = () =>
    settings.locator(".lingo-engine-row .lingo-settings-row__label");

  // A copy starts with the key, the model, and the parameters of the original.
  await settings.getByRole("button", { name: /^Claude Opus 5.5/ }).click();
  await settings.getByRole("button", { name: "Duplicate" }).click();
  await expect(settings.getByRole("heading", { level: 1 })).toHaveText(
    "Add engine",
  );
  await expect(settings.getByLabel("API key")).toHaveValue("test-key");
  await expect(settings.getByLabel("Extra parameters")).toHaveValue(
    /"temperature": 0.3/,
  );
  await expect(
    settings.getByRole("radio", { name: "Claude Opus 5.5" }),
  ).toBeChecked();
  await settings.getByRole("radio", { name: "Claude Haiku 5.5" }).check();
  await settings.getByRole("button", { name: "Add engine" }).click();
  await expect(names()).toHaveText(["Claude Opus 5.5", "Claude Haiku 5.5"]);

  // Dragging the second engine's handle above the first puts it first.
  const handle = settings.getByRole("button", {
    name: "Move Claude Haiku 5.5",
  });
  const from = await handle.boundingBox();
  const first = await settings
    .getByRole("button", { name: "Move Claude Opus 5.5" })
    .boundingBox();
  if (!from || !first) throw new Error("The handles have no place");
  await settings.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await settings.mouse.down();
  await settings.mouse.move(first.x + first.width / 2, first.y + 10, {
    steps: 5,
  });
  await expect(settings.locator(".lingo-engine-list__lifted")).toBeVisible();
  await settings.screenshot({ path: testInfo.outputPath("dragging.png") });
  await settings.mouse.up();
  await expect(names()).toHaveText(["Claude Haiku 5.5", "Claude Opus 5.5"]);

  // The first engine is the one that tasks without a choice use.
  await expect(
    settings.getByRole("button", { name: /^Translation/ }).first(),
  ).toContainText("Claude Haiku 5.5");

  // The arrow keys do the same, and the order is kept.
  await handle.focus();
  await settings.keyboard.press("ArrowDown");
  await expect(names()).toHaveText(["Claude Opus 5.5", "Claude Haiku 5.5"]);
  await settings.reload();
  await settings.getByRole("button", { name: /^Translation engines/ }).click();
  await expect(names()).toHaveText(["Claude Opus 5.5", "Claude Haiku 5.5"]);
});
