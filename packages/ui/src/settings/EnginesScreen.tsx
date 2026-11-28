import type { EngineTask } from "@lingo/core";
import { engineForTask, engineName, moveEngine } from "@lingo/core";
import { Plus } from "lucide-react";
import { Button } from "../controls/Button.tsx";
import { Callout } from "../controls/Callout.tsx";
import { EngineList } from "./EngineList.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { SettingsRow } from "./SettingsRow.tsx";
import { TASKS } from "./tasks.ts";
import type { DetailScreenProps } from "./types.ts";

export interface EnginesScreenProps extends DetailScreenProps {
  onOpenTask: (task: EngineTask) => void;
  onOpenEngine: (engineId: string) => void;
  onAdd: () => void;
}

/** The engines the user has added, and which one each task uses. */
export function EnginesScreen({
  settings,
  providers,
  onSettingsChange,
  onOpenTask,
  onOpenEngine,
  onAdd,
  onBack,
  onClose,
}: EnginesScreenProps) {
  const note = (
    <p className="lingo-settings__note">
      Lingo sends your text straight from this browser to the provider of the
      engine in use, with the API key you gave that engine.
    </p>
  );

  if (settings.engines.length === 0) {
    return (
      <>
        <PanelHeader
          title="Translation engines"
          onBack={onBack}
          onClose={onClose}
        />
        <div className="lingo-settings__content">
          <div className="lingo-settings__field">
            <Callout label="Start here">
              Add an engine: a provider, one of its models, and your API key for
              it. Lingo then translates and defines with it.
            </Callout>
          </div>
          <div className="lingo-settings__field lingo-settings__field--action">
            <Button variant="primary" onClick={onAdd}>
              Add engine
            </Button>
          </div>
          <hr className="lingo-divider" />
          {note}
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        title="Translation engines"
        onBack={onBack}
        onClose={onClose}
      />
      <div className="lingo-settings__content">
        <h2 className="lingo-group-label">Engine for</h2>
        {TASKS.map(({ task, label, icon }) => {
          const engine = engineForTask(settings, task);
          return (
            <SettingsRow
              key={task}
              icon={icon}
              label={label}
              value={engine && engineName(engine)}
              onClick={() => onOpenTask(task)}
            />
          );
        })}
        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Engines</h2>
        <EngineList
          engines={settings.engines.map((engine) => ({
            id: engine.id,
            name: engineName(engine),
            provider: providers[engine.provider].label,
          }))}
          onOpen={onOpenEngine}
          onMove={(id, toIndex) =>
            onSettingsChange(moveEngine(settings, id, toIndex))
          }
        />
        <SettingsRow icon={Plus} label="Add engine" plain onClick={onAdd} />
        <hr className="lingo-divider" />
        {note}
      </div>
    </>
  );
}
