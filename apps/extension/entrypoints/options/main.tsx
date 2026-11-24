import "./style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "../../src/settings/SettingsApp.tsx";

/*
 * The settings as a page of their own. The toolbar button opens them inside
 * the current page instead; this page is where they open when that page
 * cannot hold them, and right after the extension is installed.
 */
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <div className="lingo settings-page">
        <div className="settings-page__column">
          <SettingsApp />
        </div>
      </div>
    </StrictMode>,
  );
}
