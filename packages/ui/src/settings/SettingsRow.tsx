import { ChevronRight, ExternalLink } from "lucide-react";
import { Icon, type LucideIcon } from "../controls/Icon.tsx";

export interface SettingsRowProps {
  icon: LucideIcon;
  label: string;
  /** The current value of the setting. */
  value?: string;
  /** Shows the value in the danger color, for a setting that is missing. */
  warning?: boolean;
  /** The row leads out of the panel instead of to one of its screens. */
  external?: boolean;
  /** The row does something in place, so it shows no sign of leading on. */
  plain?: boolean;
  /** Makes the row a link that opens in a new tab. */
  href?: string;
  onClick?: () => void;
}

/** One setting in the main list: icon, label, current value, and where it leads. */
export function SettingsRow({
  icon,
  label,
  value,
  warning = false,
  external = false,
  plain = false,
  href,
  onClick,
}: SettingsRowProps) {
  const content = (
    <>
      <Icon icon={icon} size={20} />
      <span className="lingo-settings-row__label">{label}</span>
      {value && (
        <span className="lingo-settings-row__value" data-warning={warning}>
          {value}
        </span>
      )}
      {!plain && (
        <span className="lingo-settings-row__trailing">
          <Icon icon={external ? ExternalLink : ChevronRight} />
        </span>
      )}
    </>
  );

  return href ? (
    <a
      className="lingo-settings-row"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  ) : (
    <button type="button" className="lingo-settings-row" onClick={onClick}>
      {content}
    </button>
  );
}
