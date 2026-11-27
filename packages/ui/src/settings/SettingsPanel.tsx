import type { EngineTask } from "@lingo/core";
import { useState } from "react";
import { ContextScreen } from "./ContextScreen.tsx";
import { EngineScreen } from "./EngineScreen.tsx";
import { EnginesScreen } from "./EnginesScreen.tsx";
import { LanguageScreen } from "./LanguageScreen.tsx";
import { type DetailScreen, MainScreen } from "./MainScreen.tsx";
import { RequestRateScreen } from "./RequestRateScreen.tsx";
import { TaskScreen } from "./TaskScreen.tsx";
import type { SettingsPanelProps } from "./types.ts";

/** Where the panel is: a screen of the main list, or one below the engines. */
type Screen =
  | { name: "main" | DetailScreen }
  | { name: "task"; task: EngineTask }
  | { name: "addEngine" }
  | { name: "engine"; engineId: string };

/**
 * The settings of Lingo: a list of settings, and a screen for each one that
 * needs more than a row. It holds no settings itself. The host passes them in
 * and stores each change as it is reported, so there is no Save button.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const [screen, setScreen] = useState<Screen>({ name: "main" });
  const toMain = () => setScreen({ name: "main" });
  const toEngines = () => setScreen({ name: "engines" });

  return (
    <div className="lingo lingo-settings">
      {screen.name === "main" && (
        <MainScreen {...props} onOpen={(name) => setScreen({ name })} />
      )}
      {screen.name === "engines" && (
        <EnginesScreen
          {...props}
          onBack={toMain}
          onOpenTask={(task) => setScreen({ name: "task", task })}
          onOpenEngine={(engineId) => setScreen({ name: "engine", engineId })}
          onAdd={() => setScreen({ name: "addEngine" })}
        />
      )}
      {screen.name === "task" && (
        <TaskScreen {...props} task={screen.task} onBack={toEngines} />
      )}
      {screen.name === "addEngine" && (
        <EngineScreen {...props} onBack={toEngines} />
      )}
      {screen.name === "engine" && (
        <EngineScreen
          {...props}
          key={screen.engineId}
          engineId={screen.engineId}
          onBack={toEngines}
        />
      )}
      {screen.name === "language" && (
        <LanguageScreen {...props} onBack={toMain} />
      )}
      {screen.name === "context" && (
        <ContextScreen {...props} onBack={toMain} />
      )}
      {screen.name === "requestRate" && (
        <RequestRateScreen {...props} onBack={toMain} />
      )}
    </div>
  );
}
