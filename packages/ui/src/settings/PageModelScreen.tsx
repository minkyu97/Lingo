import { ModelList } from "./ModelList.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import type { DetailScreenProps } from "./types.ts";

/** Which model translates whole pages, apart from the one for lookups. */
export function PageModelScreen({
  settings,
  providers,
  onSettingsChange,
  onBack,
  onClose,
}: DetailScreenProps) {
  const providerId = settings.provider;
  const provider = providers[providerId];

  const setModel = (model: string | undefined) => {
    const pageModels = { ...settings.pageModels };
    if (model) pageModels[providerId] = model;
    else delete pageModels[providerId];
    onSettingsChange({ ...settings, pageModels });
  };

  return (
    <>
      <PanelHeader title="Page model" onBack={onBack} onClose={onClose} />
      <div className="lingo-settings__content">
        <p className="lingo-settings__note">
          The model that translates whole pages. A page takes many requests, so
          a fast model suits it. Lookups keep the model chosen under Translation
          engine.
        </p>
        <hr className="lingo-divider" />
        <h2 className="lingo-group-label">Model</h2>
        <ModelList
          models={provider.models}
          defaultModel={provider.defaultPageModel}
          model={settings.pageModels[providerId]}
          onChange={setModel}
        />
      </div>
    </>
  );
}
