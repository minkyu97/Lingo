import type { ReactNode } from "react";

export interface CalloutProps {
  /** A short label that says what the block holds. */
  label: string;
  children: ReactNode;
}

/**
 * A block that sets one piece of content apart from the rest, such as the
 * meaning of a word in the passage it came from.
 */
export function Callout({ label, children }: CalloutProps) {
  return (
    <div className="lingo-callout">
      <p className="lingo-callout__label">{label}</p>
      <p className="lingo-callout__text">{children}</p>
    </div>
  );
}
