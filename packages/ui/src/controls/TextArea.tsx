import type { TextareaHTMLAttributes } from "react";

export interface TextAreaProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange"
  > {
  /** What the field holds. It has no visible label of its own. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The value was not accepted. */
  invalid?: boolean;
}

/**
 * A field for several lines of text, set in a fixed-width face, such as
 * extra request parameters written as JSON.
 */
export function TextArea({
  label,
  value,
  onChange,
  invalid = false,
  ...rest
}: TextAreaProps) {
  return (
    <textarea
      className="lingo-text-area"
      aria-label={label}
      aria-invalid={invalid}
      spellCheck={false}
      rows={3}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...rest}
    />
  );
}
