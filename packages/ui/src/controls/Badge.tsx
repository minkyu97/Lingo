import type { ReactNode } from "react";

export interface BadgeProps {
  /**
   * Accent marks the item that applies here, such as the sense used in the
   * passage. Neutral is for plain facts, such as Default.
   */
  tone?: "accent" | "neutral";
  children: ReactNode;
}

/** A short tag beside a piece of content. */
export function Badge({ tone = "accent", children }: BadgeProps) {
  return <span className={`lingo-badge lingo-badge--${tone}`}>{children}</span>;
}
