import { Button } from "../controls/Button.tsx";
import { Icon, type LucideIcon } from "../controls/Icon.tsx";

export interface ActionRowProps {
  icon: LucideIcon;
  /** What the row is about, or what is going on right now. */
  label: string;
  /** What the button does. */
  action: string;
  /**
   * Primary for the thing to do, secondary for undoing it.
   */
  emphasis?: "primary" | "secondary";
  onAction: () => void;
}

/**
 * A row that does something to what is in front of the user, here and now,
 * rather than opening a setting. It ends in a button.
 */
export function ActionRow({
  icon,
  label,
  action,
  emphasis = "primary",
  onAction,
}: ActionRowProps) {
  return (
    <div className="lingo-action-row">
      <Icon icon={icon} size={20} />
      <span className="lingo-action-row__label">{label}</span>
      <Button variant={emphasis} onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}
