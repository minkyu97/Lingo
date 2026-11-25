import { useState } from "react";
import { ContextScreen } from "./ContextScreen.tsx";
import { EngineScreen } from "./EngineScreen.tsx";
import { LanguageScreen } from "./LanguageScreen.tsx";
import { type DetailScreen, MainScreen } from "./MainScreen.tsx";
import { PageModelScreen } from "./PageModelScreen.tsx";
import { RequestRateScreen } from "./RequestRateScreen.tsx";
import type { SettingsPanelProps } from "./types.ts";

/**
 * The settings of Lingo: a list of settings, and a screen for each one that
 * needs more than a row. It holds no settings itself. The host passes them in
 * and stores each change as it is reported, so there is no Save button.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const [screen, setScreen] = useState<DetailScreen | "main">("main");
  const back = () => setScreen("main");

  return (
    <div className="lingo lingo-settings">
      {screen === "main" && <MainScreen {...props} onOpen={setScreen} />}
      {screen === "engine" && <EngineScreen {...props} onBack={back} />}
      {screen === "language" && <LanguageScreen {...props} onBack={back} />}
      {screen === "context" && <ContextScreen {...props} onBack={back} />}
      {screen === "pageModel" && <PageModelScreen {...props} onBack={back} />}
      {screen === "requestRate" && (
        <RequestRateScreen {...props} onBack={back} />
      )}
    </div>
  );
}
