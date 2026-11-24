import type { ButtonHTMLAttributes } from "react";
import { Icon, type LucideIcon } from "./Icon.tsx";

export interface TextButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
}

/**
 * A quiet action that sits in a footer or beside text, such as Copy. It is
 * muted until the pointer is over it.
 */
export function TextButton({
  leadingIcon,
  trailingIcon,
  children,
  ...rest
}: TextButtonProps) {
  return (
    <button type="button" className="lingo-text-button" {...rest}>
      {leadingIcon && <Icon icon={leadingIcon} size={14} />}
      {children}
      {trailingIcon && <Icon icon={trailingIcon} size={14} />}
    </button>
  );
}
