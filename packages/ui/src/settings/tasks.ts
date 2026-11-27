import type { EngineTask } from "@lingo/core";
import { BookOpenText, FileText, Languages } from "lucide-react";
import type { LucideIcon } from "../controls/Icon.tsx";

/** How each task that has an engine is shown in settings. */
export const TASKS: readonly {
  task: EngineTask;
  label: string;
  icon: LucideIcon;
  /** What the engine of this task does, for the screen that chooses it. */
  note: string;
}[] = [
  {
    task: "translate",
    label: "Translation",
    icon: Languages,
    note: "The engine that translates text you select.",
  },
  {
    task: "define",
    label: "Definition",
    icon: BookOpenText,
    note: "The engine that writes the dictionary entry for a word or phrase you select.",
  },
  {
    task: "page",
    label: "Page translation",
    icon: FileText,
    note: "The engine that translates whole pages. A page takes many requests, so an engine with a fast model suits it.",
  },
];
