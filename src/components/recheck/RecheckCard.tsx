import { useCallback, useEffect, useRef, useState } from "react";

import { answerRecheck } from "../../lib/ipc/commands";
import type { DueRecheck, RecheckOutcome } from "../../lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import "./recheck.css";

/**
 * Auto-dismiss dwell after an answer (prototype `quizT`: 1700ms). Deliberately
 * NOT shortened under reduced motion — the prototype keeps 1700ms regardless;
 * it is reading time for the result line, not a transition.
 */
const DISMISS_MS = 1700;

/** Where the quiz card came from — it changes only the header label. */
export type QuizSource = "recheck" | "ledger";

export interface RecheckCardProps {
  /** The question on offer (a due recheck, or a ledger "ask me" fetch). */
  recheck: DueRecheck;
  source: QuizSource;
  /** "later ✕", Esc, or the post-answer auto-dismiss. */
  onClose: () => void;
  /** answer_recheck resolved — refresh the ledger + due-recheck state. */
  onAnswered: (outcome: RecheckOutcome) => void;
}

/**
 * The bottom-anchored quiz card — a recheck in passing, never a quiz screen.
 * Grades locally via `correct_index` for an instant paint; the server's
 * outcome supplies the "fades {next}" copy.
 */
export function RecheckCard({ recheck, source, onClose, onAnswered }: RecheckCardProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [resolved, setResolved] = useState<"correct" | "miss" | null>(null);
  const [outcome, setOutcome] = useState<RecheckOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  const pick = useCallback(
    (index: number) => {
      if (picked !== null) return;
      setPicked(index);
      setResolved(index === recheck.correct_index ? "correct" : "miss");
      clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(onClose, DISMISS_MS);
      answerRecheck(recheck.concept_id, index).then(
        (result) => {
          setOutcome(result);
          onAnswered(result);
        },
        (cause: unknown) => {
          // Don't dismiss over a failed write — surface it and stay put.
          console.error("answer recheck failed", cause);
          clearTimeout(dismissTimer.current);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    },
    [picked, recheck, onClose, onAnswered],
  );

  // Top-priority layer: 1–4 and Esc must hit the quiz before any overlay
  // beneath it (Esc closes the quiz only, never the ledger under it). Every
  // other key is consumed too, mirroring the prototype's handleKey, where no
  // key reaches the board or an overlay while the quiz card shows.
  useKeyLayer(KEY_PRIORITY.QUIZ, (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === "Escape") {
      onClose();
      return true;
    }
    if (/^[1-4]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < recheck.choices.length) pick(index);
      return true;
    }
    return true;
  });

  /** Prototype `quizChoices` state styling (design lines 580–587), as classes. */
  const choiceClass = (index: number): string => {
    let cls = "sw-recheck-choice";
    if (resolved === null) cls += " sw-recheck-choice-idle";
    else if (index === recheck.correct_index) cls += " sw-recheck-choice-hit";
    else if (resolved === "miss" && index === picked) cls += " sw-recheck-choice-missed";
    return cls;
  };

  const markFor = (index: number): string => {
    if (resolved !== null && index === recheck.correct_index)
      return resolved === "correct" ? "✓" : "→";
    if (resolved === "miss" && index === picked) return "✕";
    return "";
  };

  return (
    <div className="sw-recheck">
      <div className="sw-recheck-head">
        <span className="sw-recheck-label">
          {source === "recheck" ? "20S RECHECK — IN PASSING" : "ASK ME — FROM THE LEDGER"}
        </span>
        <span className="sw-recheck-spacer" />
        <button type="button" className="sw-recheck-close" onClick={onClose}>
          later ✕
        </button>
      </div>
      <div className="sw-recheck-q">{recheck.question}</div>
      <div className="sw-recheck-choices">
        {recheck.choices.map((choice, index) => (
          <button
            type="button"
            key={index}
            className={choiceClass(index)}
            onClick={() => pick(index)}
          >
            <span className="sw-recheck-key">{index + 1}</span>
            <span className="sw-recheck-text">{choice}</span>
            <span className="sw-recheck-mark">{markFor(index)}</span>
          </button>
        ))}
      </div>
      {resolved === "correct" && outcome !== null && (
        <div className="sw-recheck-result sw-recheck-result-correct">
          ● held — fades {outcome.next_display}
        </div>
      )}
      {resolved === "miss" && error === null && (
        <div className="sw-recheck-result">✕ {recheck.why}</div>
      )}
      {error !== null && <div className="sw-recheck-result">couldn’t record that — {error}</div>}
    </div>
  );
}
