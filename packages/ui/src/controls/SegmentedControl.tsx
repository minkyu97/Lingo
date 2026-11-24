export interface SegmentedControlProps<Value extends string> {
  /** What the choice is about, for assistive technology. */
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange?: (value: Value) => void;
  /** Medium fills the width it is given. Small hugs its labels. */
  size?: "medium" | "small";
}

/** A choice between a few options that are all visible at once. */
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  size = "medium",
}: SegmentedControlProps<Value>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a legend and default styling that a compact control has no room for
    <div
      role="group"
      aria-label={label}
      className={`lingo-segmented lingo-segmented--${size}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="lingo-segmented__option"
          aria-pressed={option.value === value}
          onClick={() => option.value !== value && onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
