import { nativeLanguageName } from "@lingo/core";
import type { PageTranslationStatus } from "./translator.ts";

/** What the button of the page bar does. */
export type BarAction = "stop" | "settings" | "retry" | "reload";

export interface BarContent {
  state: "translating" | "problem";
  label: string;
  action: BarAction;
  actionLabel: string;
}

/**
 * What the page bar says for a status, and the one thing it offers to do.
 * Undefined when there is nothing to show: translation is off, or has not
 * heard from the background yet.
 */
export function describeBar(
  status: PageTranslationStatus,
): BarContent | undefined {
  if (!status.active) return undefined;
  const provider = status.config?.provider ?? "The provider";
  const problem = (
    label: string,
    action: BarAction,
    actionLabel: string,
  ): BarContent => ({ state: "problem", label, action, actionLabel });

  switch (status.problem) {
    case undefined:
      if (!status.config) return undefined;
      return {
        state: "translating",
        label: `Translating into ${nativeLanguageName(status.config.targetLanguage)}`,
        action: "stop",
        actionLabel: "Show original",
      };
    case "missing_key":
      return problem(
        "Add an API key to translate pages",
        "settings",
        "Open settings",
      );
    case "auth":
      return problem(
        `${provider} did not accept the API key`,
        "settings",
        "Open settings",
      );
    case "network":
      return problem(`Could not reach ${provider}`, "retry", "Try again");
    case "rate_limit":
      return problem(
        `${provider} asked Lingo to slow down`,
        "retry",
        "Try again",
      );
    case "interrupted":
      return problem("Lingo lost its connection", "retry", "Try again");
    case "updated":
      return problem("Lingo was updated", "reload", "Reload page");
    default:
      return problem(
        `${provider} could not translate this page`,
        "retry",
        "Try again",
      );
  }
}
