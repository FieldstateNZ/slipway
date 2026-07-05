import { useCallback, useEffect, useRef, useState } from "react";

import { getTaskDetail } from "../../lib/ipc/commands";
import type { TaskDetail } from "../../lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import "./drawer.css";

/** Copy-button label flip window (prototype `copyNow`: 1400ms). */
const COPY_FLIP_MS = 1400;

/** Where the drawer's state machine is for the open task. */
export type DrawerPhase = "steps" | "decision" | "capture";

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
   * S5 seam: fires when the drawer crosses into the capture phase (last
   * step done, or a decision chosen). S5 replaces the placeholder pane with
   * the ONE TAP question and calls complete_task from there.
   */
  onCapturePhase?: (detail: TaskDetail, decisionChoice: number | null) => void;
}

/**
 * The task drawer — full-panel overlay where a task is actually done.
 * Steps phase (kind action/provide) or decision phase (kind decision),
 * then the capture phase (a placeholder until S5).
 */
export function Drawer({ taskId, restored, onPark, onCapturePhase }: DrawerProps) {
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

  useEffect(() => () => clearTimeout(copyTimer.current), []);

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
      onCapturePhase?.(detail, choice);
    },
    [detail, onCapturePhase],
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

  // NOTE: keys this layer leaves unhandled fall through to lower layers —
  // App gates the board layer (keysEnabled) while a drawer is open, which is
  // what gives the prototype's swallow-everything behavior. Tab is consumed
  // here so focus can't walk onto the drawer's buttons (a focused button
  // turns Enter into a click even with the key handled — see keys.ts).
  useKeyLayer(KEY_PRIORITY.DRAWER, (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === "Escape") {
      park();
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
              {"  "}
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
          {/* TODO(S5): CAPTURE phase placeholder — the ONE TAP question pane
              (design lines 192+) renders here. S5 receives (detail,
              decisionChoice) via `onCapturePhase` and calls complete_task;
              this drawer never completes a task itself. Esc still parks. */}
        </>
      )}
    </div>
  );
}
