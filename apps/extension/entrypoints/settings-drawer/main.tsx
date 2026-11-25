import "./style.css";
import { Button } from "@lingo/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { RuntimeMessage } from "../../src/messaging.ts";
import { SettingsApp } from "../../src/settings/SettingsApp.tsx";

/*
 * The settings as shown inside the in-page drawer. The content script puts
 * this page in an iframe, so that the API key is typed and shown in an
 * extension page, out of reach of the web page around it.
 *
 * A web page can put this page in an iframe of its own, to trick someone into
 * pressing things in it. So the settings are shown only when the background
 * confirms that the extension has just opened a drawer in this tab.
 */

async function openedByExtension(): Promise<boolean> {
  const message: RuntimeMessage = { type: "settings-drawer-grant" };
  const answer: unknown = await browser.runtime
    .sendMessage(message)
    .catch(() => false);
  return answer === true;
}

function closeDrawer() {
  const message: RuntimeMessage = { type: "settings-drawer", action: "close" };
  void browser.runtime.sendMessage(message).catch(() => {});
}

function Unavailable() {
  return (
    <div className="lingo settings-unavailable">
      <p>Open the settings of Lingo from its button in the toolbar.</p>
      <Button onClick={() => void browser.runtime.openOptionsPage()}>
        Open settings in a tab
      </Button>
    </div>
  );
}

// Asked once, before anything is drawn: the answer is given only once.
const expected = await openedByExtension();

if (expected) {
  // Keys pressed in this frame do not reach the page around it.
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {expected ? (
        <SettingsApp onClose={closeDrawer} inPage />
      ) : (
        <Unavailable />
      )}
    </StrictMode>,
  );
}
