import { Search } from "lucide-react";
import { Icon } from "./Icon.tsx";

export interface SearchFieldProps {
  /** What is being searched. Also shown as the placeholder. */
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** Filters a long list as the user types. */
export function SearchField({ label, value, onChange }: SearchFieldProps) {
  return (
    <div className="lingo-search-field">
      <Icon icon={Search} />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
