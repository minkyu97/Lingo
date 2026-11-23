import { ChevronLeft, X } from "lucide-react";
import { IconButton } from "../controls/IconButton.tsx";
import { Logo } from "../Logo.tsx";

export interface PanelHeaderProps {
  title: string;
  /** Present on a detail screen. The main screen shows the logo instead. */
  onBack?: () => void;
  onClose?: () => void;
}

/** The top bar of the settings panel. */
export function PanelHeader({ title, onBack, onClose }: PanelHeaderProps) {
  return (
    <header className="lingo-panel-header" data-detail={onBack !== undefined}>
      {onBack ? (
        <IconButton icon={ChevronLeft} label="Back" onClick={onBack} />
      ) : (
        <Logo />
      )}
      <h1 className="lingo-panel-header__title">{title}</h1>
      {onClose && <IconButton icon={X} label="Close" onClick={onClose} />}
    </header>
  );
}
