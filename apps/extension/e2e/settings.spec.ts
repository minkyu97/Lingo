/** Changing the settings, and what the extension does with the changes. */
import type { Page } from "@playwright/test";
import {
  drawer,
  drawerFrame,
  expect,
  openTestPage,
  pressToolbarButton,
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

test("opens inside the page when the toolbar button is pressed", async ({
  context,
  worker,
}, testInfo) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  const tabs = context.pages().length;

  await pressToolbarButton(page, worker);
  await expect(
    drawer(page).getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  // In the page, not in a tab of its own.
  expect(context.pages()).toHaveLength(tabs);
  await expectDocked(page);
  await page.screenshot({ path: testInfo.outputPath("drawer.png") });

  // A key entered here is checked and stored like anywhere else, although
  // this frame sits inside a web page.
  await drawer(page)
    .getByRole("button", { name: /^Translation engine/ })
    .click();
  await drawer(page).getByLabel("API key").fill("test-key");
  await drawer(page).getByLabel("API key").press("Enter");
  await expect(drawer(page).getByText(/^Saved\./)).toBeVisible();
  await drawer(page).getByRole("button", { name: "Back" }).click();
  await expect(
    drawer(page).getByRole("button", { name: /^Translation engine/ }),
  ).toContainText("Claude Opus 5.5");

  await drawer(page).getByRole("button", { name: "Close" }).click();
  await expect(drawerFrame(page)).toHaveCount(0);
});

test("closes on a second press and on Escape", async ({ context, worker }) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  const heading = drawer(page).getByRole("heading", { name: "Settings" });

  await pressToolbarButton(page, worker);
  await expect(heading).toBeVisible();
  await pressToolbarButton(page, worker);
  await expect(drawerFrame(page)).toHaveCount(0);

  // Escape, with the keyboard inside the drawer.
  await pressToolbarButton(page, worker);
  await expect(heading).toBeVisible();
  await heading.click();
  await page.keyboard.press("Escape");
  await expect(drawerFrame(page)).toHaveCount(0);

  // Escape, with the keyboard in the page.
  await pressToolbarButton(page, worker);
  await expect(heading).toBeVisible();
  await page.locator("h1").click();
  await page.keyboard.press("Escape");
  await expect(drawerFrame(page)).toHaveCount(0);
});

test("opens in a tab where the page cannot hold it", async ({
  context,
  worker,
}) => {
  // No content script runs in a blank tab.
  const blank = await context.newPage();
  await pressToolbarButton(blank, worker);

  // Chrome may open the settings in a new tab or in the blank one.
  const isSettings = (page: Page) => page.url().includes("options.html");
  await expect.poll(() => context.pages().some(isSettings)).toBe(true);
  const settings = context.pages().find(isSettings) ?? blank;
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  // A tab of its own has nothing to close.
  await expect(settings.getByRole("button", { name: "Close" })).toHaveCount(0);
});

test("opens inside a page that forbids frames", async ({ context, worker }) => {
  const page = await openTestPage(context, "/strict-page");
  await waitUntilListening(page, worker);

  await pressToolbarButton(page, worker);
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

test("follows the system theme inside the drawer", async ({
  context,
  worker,
}, testInfo) => {
  const page = await openTestPage(context);
  await waitUntilListening(page, worker);
  await page.emulateMedia({ colorScheme: "dark" });

  await pressToolbarButton(page, worker);
  const panel = drawer(page).locator(".lingo-settings");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("background-color", "rgb(31, 35, 40)");
  await expectDocked(page);
  await page.screenshot({ path: testInfo.outputPath("drawer-dark.png") });
});

test("checks a key with the provider before storing it", async ({
  context,
  extensionId,
}, testInfo) => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const engine = settings.getByRole("button", { name: /^Translation engine/ });
  await expect(engine).toContainText("Not set");
  await engine.click();
  const key = settings.getByLabel("API key");
  const enter = async (value: string) => {
    await key.fill(value);
    await key.press("Enter");
  };

  // A key the provider refuses is not stored.
  await enter("bad-key");
  await expect(
    settings.getByText("Not saved. Anthropic rejected this key."),
  ).toBeVisible();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(key).toHaveValue("bad-key");
  await settings.screenshot({ path: testInfo.outputPath("rejected.png") });

  // Nor is one that could not be checked. The check can be tried again.
  await enter("offline-key");
  const unreachable = settings.getByText(
    "Not saved. Lingo could not reach Anthropic.",
  );
  await expect(unreachable).toBeVisible();
  await settings.getByRole("button", { name: "Try again" }).click();
  await expect(settings.getByText(/^Checking the key/)).toBeVisible();
  await expect(unreachable).toBeVisible();

  await settings.getByRole("button", { name: "Back" }).click();
  await expect(engine).toContainText("Not set");
  await engine.click();
  await expect(key).toHaveValue("");

  // While the provider is being asked, the field cannot be edited.
  await enter("slow-key");
  await expect(
    settings.getByText("Checking the key with Anthropic…"),
  ).toBeVisible();
  await expect(key).toBeDisabled();
  await settings.screenshot({ path: testInfo.outputPath("checking.png") });
  await expect(
    settings.getByText("Saved. Anthropic accepted this key."),
  ).toBeVisible();
  await expect(key).toBeEnabled();
  await settings.screenshot({ path: testInfo.outputPath("saved.png") });

  await settings.getByRole("button", { name: "Back" }).click();
  await expect(engine).toContainText("Claude Opus 5.5");

  // Emptying the field removes the key, without asking the provider.
  await engine.click();
  await enter("");
  await settings.getByRole("button", { name: "Back" }).click();
  await expect(engine).toContainText("Not set");
});
