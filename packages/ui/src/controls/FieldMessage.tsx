import { CircleCheck, CircleExclamationPoint } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export interface FieldMessageProps {
  /**
   * Neutral explains the field. Success and danger report what happened to
   * the value just entered.
   */
  tone?: "neutral" | "success" | "danger";
  children: ReactNode;
}

const ICONS = { success: CircleCheck, danger: CircleExclamationPoint };

/**
 * One line under a field. A link or a link-styled button at its end offers
 * the next step, such as trying again.
 */
export function FieldMessage({
  tone = "neutral",
  children,
}: FieldMessageProps) {
  return (
    <p
      className={`lingo-field-message lingo-field-message--${tone}`}
      // An outcome is announced when it appears. A failure interrupts.
      role={tone === "danger" ? "alert" : "status"}
    >
      {tone !== "neutral" && <Icon icon={ICONS[tone]} size={14} />}
      {children}
    </p>
  );
}
