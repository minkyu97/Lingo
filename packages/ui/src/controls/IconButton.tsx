import type { ButtonHTMLAttributes } from "react";
import { Icon, type LucideIcon } from "./Icon.tsx";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** What the button does. It has no visible text, so this is its name. */
  label: string;
  /**
   * Makes the button a toggle that stays on until it is pressed again, such
   * as Pin. Leave it out for a plain button, such as Close.
   */
  pressed?: boolean;
}

/** A 28px button that shows only an icon. */
export function IconButton({ icon, label, pressed, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className="lingo-icon-button"
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon icon={icon} />
    </button>
  );
}
