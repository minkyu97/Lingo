import {
  type CapturedContext,
  type ContextLevel,
  dictionaryEntryToText,
  hasDictionaryContent,
  type LLMErrorKind,
  type LookupMode,
  parseDictionaryEntry,
} from "@lingo/core";
import { useMemo, useState } from "react";
import { DictionaryEntryView } from "./DictionaryEntryView.tsx";

export type LookupStatus = "loading" | "streaming" | "done" | "error";

export interface LookupCardProps {
  mode: LookupMode;
  status: LookupStatus;
  /**
   * The answer so far. Grows while the status is `streaming`. A translation
   * is plain text; a definition is a dictionary entry as JSON.
   */
  text: string;
  /** The context that was sent with the request, once known. */
  context?: CapturedContext;
  error?: { kind: LLMErrorKind; message: string };
  onModeChange?: (mode: LookupMode) => void;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onClose?: () => void;
}

const MODES: { id: LookupMode; label: string }[] = [
  { id: "translate", label: "Translate" },
  { id: "define", label: "Define" },
];

const CONTEXT_LABELS: Record<ContextLevel, string> = {
  none: "Selection only",
  sentence: "Sentence context",
  paragraph: "Paragraph context",
  document: "Document context",
};

/** Messages for errors the user can do something about. */
const ERROR_MESSAGES: Partial<Record<LLMErrorKind, string>> = {
  missing_key: "Add an API key in settings to start using Lingo.",
  auth: "The provider rejected your API key. Check it in settings.",
  rate_limit: "The provider is limiting your requests. Try again in a moment.",
  refusal: "The model declined this request.",
  network: "Could not reach the provider. Check your connection.",
};

const SETTINGS_ERRORS: readonly LLMErrorKind[] = ["missing_key", "auth"];

/** The start of a JSON answer, possibly inside a Markdown code fence. */
const JSON_START = /^\s*(`|\{)/;

/** Shows one lookup: the streaming answer, its mode, and what was sent. */
export function LookupCard(props: LookupCardProps) {
  const { mode, status, text, context, error } = props;
  const [showContext, setShowContext] = useState(false);
  const [copied, setCopied] = useState(false);

  // A definition arrives as JSON. A model that ignored the format leaves
  // `entry` undefined, and its answer is shown as plain text instead.
  const entry = useMemo(
    () => (mode === "define" ? parseDictionaryEntry(text) : undefined),
    [mode, text],
  );
  const showEntry = entry !== undefined && hasDictionaryContent(entry);
  // JSON has started to arrive but holds nothing to show yet.
  const awaitingEntry =
    mode === "define" &&
    status === "streaming" &&
    !showEntry &&
    JSON_START.test(text);

  const hasContext = context !== undefined && context.level !== "none";

  async function copy() {
    const copyable = showEntry ? dictionaryEntryToText(entry) : text;
    await navigator.clipboard.writeText(copyable);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="lingo lingo-card" aria-label="Lingo lookup">
      <header className="lingo-card__header">
        <div className="lingo-card__modes">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="lingo-card__mode"
              aria-pressed={id === mode}
              onClick={() => id !== mode && props.onModeChange?.(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="lingo-card__icon"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>

      <div className="lingo-card__body" aria-live="polite">
        {status === "error" && error ? (
          <div className="lingo-card__error" role="alert">
            <p>{ERROR_MESSAGES[error.kind] ?? error.message}</p>
            {SETTINGS_ERRORS.includes(error.kind) ? (
              <button
                type="button"
                className="lingo-card__action"
                onClick={props.onOpenSettings}
              >
                Open settings
              </button>
            ) : (
              <button
                type="button"
                className="lingo-card__action"
                onClick={props.onRetry}
              >
                Try again
              </button>
            )}
          </div>
        ) : status === "loading" || awaitingEntry ? (
          <p className="lingo-card__placeholder">Thinking…</p>
        ) : showEntry ? (
          <DictionaryEntryView
            entry={entry}
            streaming={status === "streaming"}
          />
        ) : (
          <p
            className="lingo-card__text"
            data-streaming={status === "streaming"}
          >
            {text}
          </p>
        )}
      </div>

      <footer className="lingo-card__footer">
        {context === undefined ? (
          <span />
        ) : hasContext ? (
          <button
            type="button"
            className="lingo-card__link"
            aria-expanded={showContext}
            onClick={() => setShowContext((shown) => !shown)}
          >
            {CONTEXT_LABELS[context.level]}
          </button>
        ) : (
          <span className="lingo-card__muted">{CONTEXT_LABELS.none}</span>
        )}
        {status === "done" && (
          <button type="button" className="lingo-card__link" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </footer>

      {showContext && hasContext && (
        <div className="lingo-card__context">
          <p className="lingo-card__muted">Sent with your selection:</p>
          <p>
            {context.before}
            <mark>{context.selection}</mark>
            {context.after}
          </p>
        </div>
      )}
    </section>
  );
}
