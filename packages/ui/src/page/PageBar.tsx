import { CircleExclamationPoint, X } from "lucide-react";
import { Button } from "../controls/Button.tsx";
import { Icon } from "../controls/Icon.tsx";
import { IconButton } from "../controls/IconButton.tsx";
import { Logo } from "../Logo.tsx";

export interface PageBarProps {
  /**
   * `translating` for as long as the page is translated. `problem` when
   * translation has stopped and waits for the user.
   */
  state: "translating" | "problem";
  /** One line that says what is happening. */
  label: string;
  /** The one thing to do about it. */
  action: { label: string; onClick: () => void };
  /**
   * Turns page translation off. A problem shows a close button for it,
   * because its action is taken up by the way out of the problem.
   */
  onStop: () => void;
}

/**
 * The bar that floats at the bottom of a page for as long as the page is
 * translated. It says what is happening and holds the one thing to do about
 * it. The host positions it.
 */
export function PageBar({ state, label, action, onStop }: PageBarProps) {
  return (
    <section
      className="lingo lingo-page-bar"
      aria-label="Lingo page translation"
      data-state={state}
    >
      {state === "translating" ? (
        <Logo detail="plain" size={18} />
      ) : (
        <span className="lingo-page-bar__alert">
          <Icon icon={CircleExclamationPoint} />
        </span>
      )}
      {/* Read out when it changes, as when a problem comes up. */}
      <span className="lingo-page-bar__label" role="status">
        {label}
      </span>
      <span className="lingo-page-bar__separator" aria-hidden="true" />
      <Button variant="ghost" onClick={action.onClick}>
        {action.label}
      </Button>
      {state === "problem" && (
        <IconButton icon={X} label="Stop translating" onClick={onStop} />
      )}
    </section>
  );
}
