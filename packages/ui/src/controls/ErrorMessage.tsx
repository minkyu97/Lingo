import { CircleExclamationPoint } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/**
 * Says what went wrong, in plain text beside a danger-colored icon. Follow it
 * with one button that fixes the problem.
 */
export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p className="lingo-error-message">
      <Icon icon={CircleExclamationPoint} />
      <span>{children}</span>
    </p>
  );
}
