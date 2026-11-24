import {
  type CapturedContext,
  type ContextLevel,
  dictionaryEntryToText,
  hasDictionaryContent,
  type LLMErrorKind,
  type LookupMode,
  parseDictionaryEntry,
} from "@lingo/core";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  GripHorizontal,
  Pin,
  X,
} from "lucide-react";
import { type PointerEvent, useMemo, useState } from "react";
import { Button } from "../controls/Button.tsx";
import { ErrorMessage } from "../controls/ErrorMessage.tsx";
import { Icon } from "../controls/Icon.tsx";
import { IconButton } from "../controls/IconButton.tsx";
import { SegmentedControl } from "../controls/SegmentedControl.tsx";
import { TextButton } from "../controls/TextButton.tsx";
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
  /** Whether the card stays open until Close is pressed. */
  pinned?: boolean;
  onModeChange?: (mode: LookupMode) => void;
  onPinnedChange?: (pinned: boolean) => void;
  /**
   * Called when the header is pressed outside its controls. A host that can
   * move the card starts the move here; the header then shows a grab cursor.
   */
  onDragStart?: (event: PointerEvent<HTMLElement>) => void;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onClose?: () => void;
}

const MODES: { value: LookupMode; label: string }[] = [
  { value: "translate", label: "Translate" },
  { value: "define", label: "Define" },
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
  const { mode, status, text, context, error, pinned = false } = props;
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

  function startDrag(event: PointerEvent<HTMLElement>) {
    // A press on a control is for that control, not for moving the card.
    const onControl = (event.target as Element).closest("button") !== null;
    if (event.button === 0 && !onControl) props.onDragStart?.(event);
  }

  return (
    <section className="lingo lingo-card" aria-label="Lingo lookup">
      <header
        className="lingo-card__header"
        data-draggable={props.onDragStart !== undefined}
        onPointerDown={startDrag}
      >
        <SegmentedControl
          label="Mode"
          size="small"
          options={MODES}
          value={mode}
          onChange={props.onModeChange}
        />
        {/* A hint that the header can be dragged. The whole header is the handle. */}
        <span className="lingo-card__handle" aria-hidden="true">
          <Icon icon={GripHorizontal} />
        </span>
        <div className="lingo-card__actions">
          <IconButton
            icon={Pin}
            label="Pin"
            title="Keep open until closed"
            pressed={pinned}
            onClick={() => props.onPinnedChange?.(!pinned)}
          />
          <IconButton icon={X} label="Close" onClick={props.onClose} />
        </div>
      </header>

      <div className="lingo-card__body" aria-live="polite">
        {status === "error" && error ? (
          <div className="lingo-card__error" role="alert">
            <ErrorMessage>
              {ERROR_MESSAGES[error.kind] ?? error.message}
            </ErrorMessage>
            {SETTINGS_ERRORS.includes(error.kind) ? (
              <Button onClick={props.onOpenSettings}>Open settings</Button>
            ) : (
              <Button onClick={props.onRetry}>Try again</Button>
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
          <TextButton
            trailingIcon={showContext ? ChevronUp : ChevronDown}
            aria-expanded={showContext}
            onClick={() => setShowContext((shown) => !shown)}
          >
            {CONTEXT_LABELS[context.level]}
          </TextButton>
        ) : (
          <span className="lingo-card__footnote">{CONTEXT_LABELS.none}</span>
        )}
        {status === "done" && (
          <TextButton leadingIcon={copied ? Check : Copy} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </TextButton>
        )}
      </footer>

      {showContext && hasContext && (
        <div className="lingo-card__context">
          <p>Sent with your selection</p>
          <p>
            {context.before}
            <strong>{context.selection}</strong>
            {context.after}
          </p>
        </div>
      )}
    </section>
  );
}
