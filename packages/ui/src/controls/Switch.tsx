import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange?: (checked: boolean) => void;
}

/**
 * An on/off switch. Name it with `aria-label`, or with `aria-labelledby`
 * when the text beside it already says what it controls.
 */
export function Switch({ checked, onChange, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="lingo-switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      {...rest}
    />
  );
}
