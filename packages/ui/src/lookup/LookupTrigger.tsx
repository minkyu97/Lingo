import type { ButtonHTMLAttributes } from "react";
import { Logo } from "../Logo.tsx";

/**
 * The button that appears beside a new text selection. Pressing it opens the
 * lookup card. The host positions it.
 */
export function LookupTrigger(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="lingo lingo-trigger"
      aria-label="Look up with Lingo"
      {...props}
    >
      <Logo detail="plain" size={18} />
    </button>
  );
}
