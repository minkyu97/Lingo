import type { ButtonHTMLAttributes } from "react";
import { Icon, type LucideIcon } from "./Icon.tsx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Primary for the one main action of a view, secondary for the others,
   * ghost where a border would add noise.
   */
  variant?: "primary" | "secondary" | "ghost";
  /** An icon that leads the label. */
  icon?: LucideIcon;
}

/** An action with a text label. */
export function Button({
  variant = "secondary",
  icon,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`lingo-button lingo-button--${variant}`}
      {...rest}
    >
      {icon && <Icon icon={icon} />}
      {children}
    </button>
  );
}
