import type {
  CapturedContext,
  ContextLevel,
  LLMErrorKind,
  LookupMode,
} from "@lingo/core";
import { useState } from "react";

export type LookupStatus = "loading" | "streaming" | "done" | "error";

export interface LookupCardProps {
  mode: LookupMode;
  status: LookupStatus;
  /** The answer so far. Grows while the status is `streaming`. */
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

/** Shows one lookup: the streaming answer, its mode, and what was sent. */
export function LookupCard(props: LookupCardProps) {
  const { mode, status, text, context, error } = props;
  const [showContext, setShowContext] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasContext = context !== undefined && context.level !== "none";

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="lingo-card" aria-label="Lingo lookup">
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
        ) : status === "loading" ? (
          <p className="lingo-card__placeholder">Thinking…</p>
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
