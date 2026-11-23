import { Check } from "lucide-react";
import { Icon } from "../controls/Icon.tsx";

export interface OptionRowProps {
  /** Shared by the rows of one list, so that exactly one is selected. */
  name: string;
  label: string;
  /** A muted note beside the label, such as the name in English. */
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * One choice in a list where exactly one is selected, such as a model or a
 * language. It is a radio button drawn as a row with a check mark.
 */
export function OptionRow({
  name,
  label,
  description,
  checked,
  disabled = false,
  onSelect,
}: OptionRowProps) {
  return (
    <label className="lingo-option-row">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <span>{label}</span>
      {description && (
        <span className="lingo-option-row__description">{description}</span>
      )}
      <span className="lingo-option-row__check">
        <Icon icon={Check} />
      </span>
    </label>
  );
}
