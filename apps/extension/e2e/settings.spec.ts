/** Changing the settings, and what the extension does with the changes. */
import { expect, test } from "./extension.ts";

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
