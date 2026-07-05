import { useCallback, useEffect, useRef, useState } from "react";

import { completeTask, getTaskDetail } from "../../lib/ipc/commands";
import type { CaptureResult, CompleteResult, TaskDetail } from "../../lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import { useSettings } from "../../lib/settings";
import "./drawer.css";

/** Copy-button label flip window (prototype `copyNow`: 1400ms). */
const COPY_FLIP_MS = 1400;

/** Correct-pick dwell before the drawer finishes (prototype `pickCap`: rm()?250:900). */
const CAPTURE_FINISH_MS = 900;
const CAPTURE_FINISH_REDUCED_MS = 250;

/** Where the drawer's state machine is for the open task. */
export type DrawerPhase = "steps" | "decision" | "capture";

/** Capture-question resolution state (prototype `capState`). */
type CaptureState = "correct" | "miss" | null;

/**
 * The state that survives a park (Esc). App keeps one per task id so
 * reopening the same task restores exactly where it was left.
 */
export interface DrawerParkSnapshot {
  phase: DrawerPhase;
  stepIdx: number;
  decisionChoice: number | null;
}

export interface DrawerProps {
  taskId: string;
  /** Parked snapshot from a previous open of this task, if any. */
  restored: DrawerParkSnapshot | null;
  /**
   * Esc or "esc parks it ✕" — close WITHOUT completing. `snapshot` is null
   * when there is nothing new to remember (detail never loaded); the caller
   * keeps any previously parked state in that case.
   */
  onPark: (snapshot: DrawerParkSnapshot | null) => void;
  /**
   * The capture resolved and `complete_task` succeeded. The drawer grades
   * locally and calls the IPC itself; the caller owns the aftermath — close
   * the drawer, DROP the task's parked snapshot (a completed task must never
   * restore stale state), and run the board choreography + footer toast
   * (App derives the lane from the board and the toast copy from `result`).
   */
  onComplete: (result: CompleteResult, outcome: CaptureResult) => void;
}

/**
 * The task drawer — full-panel overlay where a task is actually done.
 * Steps phase (kind action/provide) or decision phase (kind decision),
 * then the capture phase: the ONE TAP question, the signature mechanic.
 */
export function Drawer({ taskId, restored, onPark, onComplete }: DrawerProps) {
  const { reducedMotion } = useSettings();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [phaseState, setPhaseState] = useState<DrawerPhase | null>(restored?.phase ?? null);
  const [stepIdx, setStepIdx] = useState(restored?.stepIdx ?? 0);
  // Concept disclosure is strictly opt-in: closed on every open and advance.
  const [conceptOpen, setConceptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [decisionChoice, setDecisionChoice] = useState<number | null>(
    restored?.decisionChoice ?? null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Capture question state. Picks never park — a reopened capture starts idle.
  const [capState, setCapState] = useState<CaptureState>(null);
  const [capPicked, setCapPicked] = useState<number | null>(null);
  // Correct-pick finish gate: complete_task fires on the pick, but the drawer
  // only finishes once BOTH the dwell timer AND the response have landed.
  const [capResult, setCapResult] = useState<CompleteResult | null>(null);
  const [capTimerDone, setCapTimerDone] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitting = useRef(false);
  const finished = useRef(false);

  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      clearTimeout(capTimer.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    getTaskDetail(taskId).then(
      (fetched) => {
        if (!cancelled) setDetail(fetched);
      },
      (cause: unknown) => {
        console.error("task detail failed", cause);
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Entry phase comes from the task kind unless a park snapshot pinned it.
  const phase: DrawerPhase | null =
    phaseState ?? (detail === null ? null : detail.kind === "decision" ? "decision" : "steps");

  const park = useCallback(() => {
    onPark(phase === null ? null : { phase, stepIdx, decisionChoice });
  }, [onPark, phase, stepIdx, decisionChoice]);

  const enterCapture = useCallback(
    (choice: number | null) => {
      if (detail === null) return;
      setPhaseState("capture");
      setConceptOpen(false);
      if (choice !== null) setDecisionChoice(choice);
    },
    [detail],
  );

  const advanceStep = useCallback(() => {
    if (detail === null || phase !== "steps") return;
    if (stepIdx + 1 >= detail.steps.length) {
      enterCapture(null);
    } else {
      // Prototype `completeStepFn`: advancing resets disclosure + copy label.
      setStepIdx(stepIdx + 1);
      setConceptOpen(false);
      setCopied(false);
      clearTimeout(copyTimer.current);
    }
  }, [detail, phase, stepIdx, enterCapture]);

  const chooseDecision = useCallback(
    (index: number) => {
      if (phase !== "decision") return;
      enterCapture(index);
    },
    [phase, enterCapture],
  );

  const copyNow = useCallback((cmd: string) => {
    try {
      void navigator.clipboard.writeText(cmd).catch(() => undefined);
    } catch {
      // Clipboard unavailable — the label still flips (prototype `copyNow`).
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), COPY_FLIP_MS);
  }, []);

  /** complete_task with this drawer's decision choice attached, if any. */
  const submitComplete = useCallback(
    (outcome: CaptureResult): Promise<CompleteResult> => {
      if (detail === null) return Promise.reject(new Error("no task detail"));
      return decisionChoice === null
        ? completeTask(detail.id, outcome)
        : completeTask(detail.id, outcome, decisionChoice);
    },
    [detail, decisionChoice],
  );

  const failComplete = useCallback((cause: unknown) => {
    // Never close the drawer (or run choreography) on a failed completion —
    // surface it inline and re-open the Esc exit.
    console.error("complete task failed", cause);
    submitting.current = false;
    setCompleteError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const pickCap = useCallback(
    (index: number) => {
      if (detail === null || capState !== null || submitting.current) return;
      setCapPicked(index);
      setCompleteError(null);
      if (index === detail.capture.correct_index) {
        setCapState("correct");
        clearTimeout(capTimer.current);
        capTimer.current = setTimeout(
          () => setCapTimerDone(true),
          reducedMotion ? CAPTURE_FINISH_REDUCED_MS : CAPTURE_FINISH_MS,
        );
        // Fire immediately; the response's capture feeds the stamp + toast.
        submitComplete("correct").then(setCapResult, failComplete);
      } else {
        setCapState("miss");
      }
    },
    [detail, capState, reducedMotion, submitComplete, failComplete],
  );

  // Correct pick finishes when both the dwell timer and the response are in.
  useEffect(() => {
    if (capState === "correct" && capTimerDone && capResult !== null && !finished.current) {
      finished.current = true;
      onComplete(capResult, "correct");
    }
  }, [capState, capTimerDone, capResult, onComplete]);

  /** Miss ("Got it — continue ↵") and skip ('s' — stays hollow) exits. */
  const finishWith = useCallback(
    (outcome: "miss" | "hollow") => {
      if (submitting.current || finished.current) return;
      submitting.current = true;
      setCompleteError(null);
      submitComplete(outcome).then((result) => {
        finished.current = true;
        onComplete(result, outcome);
      }, failComplete);
    },
    [submitComplete, onComplete, failComplete],
  );

  // NOTE: keys this layer leaves unhandled fall through to lower layers —
  // App gates the board layer (keysEnabled) while a drawer is open, which is
  // what gives the prototype's swallow-everything behavior. Tab is consumed
  // here so focus can't walk onto the drawer's buttons (a focused button
  // turns Enter into a click even with the key handled — see keys.ts).
  useKeyLayer(KEY_PRIORITY.DRAWER, (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === "Escape") {
      // Prototype: once a capture pick landed (correct dwell or miss reveal)
      // only capture keys act — Esc is consumed but does nothing. A failed
      // complete re-opens the exit so the user is never trapped.
      const captureLocked =
        phase === "capture" && (capState !== null || submitting.current) && completeError === null;
      if (!captureLocked) park();
      return true;
    }
    if (event.key === "Tab") {
      return true;
    }
    if (phase === "steps" && event.key === "Enter") {
      advanceStep();
      return true;
    }
    if (phase === "decision" && (event.key === "1" || event.key === "2")) {
      const index = Number(event.key) - 1;
      if (detail !== null && index < detail.decision_options.length) {
        chooseDecision(index);
        return true;
      }
    }
    if (phase === "capture") {
      if (capState === "miss" && event.key === "Enter") {
        finishWith("miss");
        return true;
      }
      if (capState === null) {
        if (/^[1-4]$/.test(event.key)) {
          const index = Number(event.key) - 1;
          if (detail !== null && index < detail.capture.choices.length) {
            pickCap(index);
            return true;
          }
        }
        if (event.key === "s") {
          finishWith("hollow");
          return true;
        }
      }
    }
    return false;
  });

  if (detail === null) {
    // Loading (or failed) state: keep the header's park affordance so a
    // mouse-only user can always leave even if the detail fetch rejected.
    return (
      <div className="sw-drawer">
        <div className="sw-drawer-head">
          <span className="sw-drawer-crumb">{loadFailed ? "couldn’t load this task" : ""}</span>
          <span className="sw-drawer-head-spacer" />
          <button type="button" className="sw-drawer-close" onClick={park}>
            esc parks it ✕
          </button>
        </div>
      </div>
    );
  }

  const crumb =
    `${detail.project_full_name} · ${detail.id}` +
    (detail.effort_min > 0 ? ` · ${detail.effort_min}m` : "");
  const step = detail.steps[stepIdx];
  const stepCmd = step?.cmd ?? null;
  const correctIndex = detail.capture.correct_index;

  /** Prototype `capChoices` state styling (design lines 571–579), as classes. */
  const capChoiceClass = (index: number): string => {
    let cls = "sw-drawer-cap-choice";
    if (capState === null) cls += " sw-drawer-cap-choice-idle";
    else if (capState === "correct" && index === correctIndex)
      cls += " sw-drawer-cap-choice-correct";
    else if (capState === "miss" && index === capPicked) cls += " sw-drawer-cap-choice-missed";
    else if (capState === "miss" && index === correctIndex) cls += " sw-drawer-cap-choice-reveal";
    return cls;
  };

  const capMark = (index: number): string => {
    if (capState === "correct" && index === correctIndex) return "✓";
    if (capState === "miss" && index === capPicked) return "✕";
    if (capState === "miss" && index === correctIndex) return "→ this one";
    return "";
  };

  return (
    <div className="sw-drawer">
      <div className="sw-drawer-head">
        <span className="sw-drawer-crumb">{crumb}</span>
        <span className="sw-drawer-head-spacer" />
        <button type="button" className="sw-drawer-close" onClick={park}>
          esc parks it ✕
        </button>
      </div>

      {(phase === "steps" || phase === "decision") && (
        <>
          <div className="sw-drawer-title">{detail.title}</div>
          <div className="sw-drawer-sub">
            {detail.sub} <span className="sw-drawer-frees">{detail.frees}</span>
          </div>
          <div className="sw-drawer-before">
            <div className="sw-drawer-before-label">BEFORE — 20 SECONDS</div>
            <div className="sw-drawer-before-body">{detail.before}</div>
          </div>
        </>
      )}

      {phase === "steps" && step !== undefined && (
        <>
          <div className="sw-drawer-phase-label">
            STEP {stepIdx + 1} OF {detail.steps.length}
          </div>
          <div className="sw-drawer-step">
            <div className="sw-drawer-step-text">{step.text}</div>
            {stepCmd !== null && (
              <div className="sw-drawer-cmd">
                <span className="sw-drawer-cmd-text">{stepCmd}</span>
                <button type="button" className="sw-drawer-copy" onClick={() => copyNow(stepCmd)}>
                  ⧉ {copied ? "copied" : "copy"}
                </button>
              </div>
            )}
            {step.concept_label !== null && (
              <>
                <button
                  type="button"
                  className="sw-drawer-concept-toggle"
                  onClick={() => setConceptOpen((open) => !open)}
                >
                  {conceptOpen ? "▴ tuck away" : `▸ ${step.concept_label} — 10s`}
                </button>
                {conceptOpen && (
                  <div className="sw-drawer-concept">
                    <div className="sw-drawer-concept-text">{step.concept_text}</div>
                  </div>
                )}
              </>
            )}
          </div>
          {detail.steps.slice(stepIdx + 1).map((later, k) => (
            <div
              key={stepIdx + 1 + k}
              className="sw-drawer-rem"
              style={{ opacity: k === 0 ? 0.6 : 0.4, marginLeft: 12 + k * 12 }}
            >
              {/* Two non-breaking spaces after "then", per the design template. */}
              <span className="sw-drawer-rem-then">then</span>
              {"  "}
              {later.text}
            </div>
          ))}
          <div className="sw-drawer-horizon">⚑ then one question ◌→●</div>
          <div className="sw-drawer-cta-wrap">
            <button type="button" className="sw-drawer-cta" onClick={advanceStep}>
              {stepIdx + 1 >= detail.steps.length ? "Done — one question ↵" : "Done — next step ↵"}
            </button>
          </div>
        </>
      )}

      {phase === "decision" && (
        <>
          <div className="sw-drawer-phase-label">THE CALL — PICK ONE</div>
          {detail.decision_options.map((option, index) => (
            <button
              type="button"
              key={index}
              className="sw-drawer-option"
              onClick={() => chooseDecision(index)}
            >
              <span className="sw-drawer-option-row">
                <span className="sw-drawer-option-num">{index + 1}</span>
                <span className="sw-drawer-option-title">{option.title}</span>
              </span>
              <span className="sw-drawer-option-body">{option.body}</span>
            </button>
          ))}
          <div className="sw-drawer-dec-footer">
            choosing completes the task — then one question
          </div>
        </>
      )}

      {phase === "capture" && (
        <>
          <div className="sw-drawer-done">
            {(detail.kind === "decision"
              ? [
                  `call made — ${
                    (decisionChoice !== null && detail.decision_options[decisionChoice]?.title) ||
                    ""
                  }`,
                ]
              : detail.steps.map((done) => done.text)
            ).map((line, index) => (
              <span key={index} className="sw-drawer-done-line">
                ✓ {line}
              </span>
            ))}
          </div>
          <div className="sw-drawer-cap-spacer" />
          <div className="sw-drawer-cap-label">ONE TAP.</div>
          <div className="sw-drawer-cap-q">{detail.capture.question}</div>
          <div className="sw-drawer-cap-choices">
            {detail.capture.choices.map((choice, index) => (
              <button
                type="button"
                key={index}
                className={capChoiceClass(index)}
                onClick={() => pickCap(index)}
              >
                <span className="sw-drawer-cap-key">{index + 1}</span>
                <span className="sw-drawer-cap-text">{choice}</span>
                <span className="sw-drawer-cap-mark">{capMark(index)}</span>
              </button>
            ))}
          </div>
          {capState === "miss" && (
            <>
              <div className="sw-drawer-cap-why">{detail.capture.why}</div>
              <button
                type="button"
                className="sw-drawer-cap-continue"
                onClick={() => finishWith("miss")}
              >
                Got it — continue ↵
              </button>
            </>
          )}
          {capState === "correct" && capResult?.capture != null && (
            <div className="sw-drawer-cap-stamp">● {capResult.capture.name} — captured</div>
          )}
          {completeError !== null && (
            <div className="sw-drawer-cap-error">couldn’t complete — {completeError}</div>
          )}
          <div className="sw-drawer-cap-spacer" />
          {capState === null && (
            <div className="sw-drawer-cap-idle">
              1–4 commit ·{" "}
              <button
                type="button"
                className="sw-drawer-cap-skip"
                onClick={() => finishWith("hollow")}
              >
                s skip — stays hollow ◌
              </button>{" "}
              · misses return sooner
            </div>
          )}
        </>
      )}
    </div>
  );
}
