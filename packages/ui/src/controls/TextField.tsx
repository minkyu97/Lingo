import { LoaderCircle } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  /** What the field holds. It has no visible label of its own. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * The value is being checked: the field is dimmed, cannot be edited, and
   * shows a spinner at its right end.
   */
  busy?: boolean;
  /** The value was not accepted. */
  invalid?: boolean;
  /** A control at the right end, such as the button that reveals a key. */
  trailing?: ReactNode;
}

/** A one-line input. */
export function TextField({
  label,
  value,
  onChange,
  busy = false,
  invalid = false,
  trailing,
  ...rest
}: TextFieldProps) {
  return (
    <div className="lingo-text-field" data-busy={busy} data-invalid={invalid}>
      <input
        type="text"
        aria-label={label}
        aria-invalid={invalid}
        aria-busy={busy}
        disabled={busy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      {busy ? (
        <span className="lingo-text-field__spinner">
          <Icon icon={LoaderCircle} />
        </span>
      ) : (
        trailing
      )}
    </div>
  );
}
