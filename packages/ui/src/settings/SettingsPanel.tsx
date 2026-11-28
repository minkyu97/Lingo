import type { EngineTask } from "@lingo/core";
import { useState } from "react";
import { CacheScreen } from "./CacheScreen.tsx";
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
  | { name: "addEngine"; copyOf?: string }
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
  const duplicate = (copyOf: string) =>
    setScreen({ name: "addEngine", copyOf });

  return (
    <div className="lingo lingo-settings">
      {screen.name === "main" && (
        <MainScreen
          {...props}
          onOpen={(name) => {
            // What was stored while the panel was open is counted too.
            if (name === "cache") props.cache.onRefresh();
            setScreen({ name });
          }}
        />
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
        <EngineScreen
          {...props}
          // Apart from the screen of the engine it copies, which has that ID.
          key={`copy of ${screen.copyOf}`}
          copyOf={screen.copyOf}
          onDuplicate={duplicate}
          onBack={toEngines}
        />
      )}
      {screen.name === "engine" && (
        <EngineScreen
          {...props}
          key={`engine ${screen.engineId}`}
          engineId={screen.engineId}
          onDuplicate={duplicate}
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
      {screen.name === "cache" && <CacheScreen {...props} onBack={toMain} />}
    </div>
  );
}
