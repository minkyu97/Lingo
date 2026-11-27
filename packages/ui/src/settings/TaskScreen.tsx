import { type EngineTask, engineForTask, engineName } from "@lingo/core";
import { OptionRow } from "./OptionRow.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { TASKS } from "./tasks.ts";
import type { DetailScreenProps } from "./types.ts";

/** Which of the user's engines one task uses. */
export function TaskScreen({
  task,
  settings,
  providers,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps & { task: EngineTask }) {
  const shown = TASKS.find((entry) => entry.task === task);
  const chosen = engineForTask(settings, task);
  if (!shown) return null;

  return (
    <>
      <PanelHeader title={shown.label} onBack={onBack} onClose={onClose} />
      <div className="lingo-settings__content">
        <p className="lingo-settings__note">{shown.note}</p>
        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Engine</h2>
        <div role="radiogroup" aria-label="Engine">
          {settings.engines.map((engine) => (
            <OptionRow
              key={engine.id}
              name="engine"
              label={engineName(engine)}
              description={providers[engine.provider].label}
              checked={engine.id === chosen?.id}
              onSelect={() =>
                onSettingsChange({
                  ...settings,
                  engineFor: { ...settings.engineFor, [task]: engine.id },
                })
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
