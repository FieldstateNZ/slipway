import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import seedRaw from "../../../seed/launch-graph.json?raw";
import { displayedFocus, queueLength } from "../../lib/board/present";
import { completeTask, importGraph } from "../../lib/ipc/commands";
import type { BoardView } from "../../lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import { useSettings } from "../../lib/settings";
import { Lane } from "./Lane";
import "./board.css";

/** Advancing window before the next card settles (prototype: 1150ms / 60ms rm). */
const ADVANCE_MS = 1150;
const ADVANCE_REDUCED_MS = 60;

export interface BoardHandle {
  /**
   * Completion choreography entry point. The completing caller (S4 drawer,
   * S5 capture) reports a finished task here with the footer toast text;
   * the board runs the slide-out pill + advancing header + dock-in sequence
   * and refetches server state.
   */
  onCompleted: (taskId: string, projectKey: string, toast: string) => void;
}

export interface BoardProps {
  board: BoardView;
  refresh: () => Promise<void>;
  /** Open the task drawer (no-op until S4). */
  onOpenTask: (taskId: string) => void;
  /** Send toast text to the footer slot (App owns the timeout). */
  onToast: (toast: string) => void;
  ref?: Ref<BoardHandle>;
}

/** The home surface: lanes of one. */
export function Board({ board, refresh, onOpenTask, onToast, ref }: BoardProps) {
  const { reducedMotion } = useSettings();
  const lanes = board.lanes;

  const [activeLane, setActiveLane] = useState(0);
  const [dealOffsets, setDealOffsets] = useState<Record<string, number>>({});
  const [dockNonces, setDockNonces] = useState<Record<string, number>>({});
  const [advancing, setAdvancing] = useState<{ laneKey: string; taskId: string } | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  // Track lane shape so client state never outlives the lanes it indexed:
  // reset empties the board (clear everything, like the prototype's resetAll),
  // and a removed lane can strand activeLane past the end (snap home).
  useEffect(() => {
    if (lanes.length === 0) {
      setActiveLane(0);
      setDealOffsets({});
      setDockNonces({});
      setAdvancing(null);
    } else if (activeLane >= lanes.length) {
      setActiveLane(0);
    }
  }, [lanes.length, activeLane]);

  const handleCompleted = useCallback(
    (taskId: string, projectKey: string, toast: string) => {
      // Pill slides out + header shows "advancing…" while the fresh board
      // (with the next focus card) docks in; the deal offset snaps home.
      setAdvancing({ laneKey: projectKey, taskId });
      setDealOffsets((prev) => ({ ...prev, [projectKey]: 0 }));
      onToast(toast);
      void refresh();
      clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(
        () => setAdvancing(null),
        reducedMotion ? ADVANCE_REDUCED_MS : ADVANCE_MS,
      );
    },
    [onToast, refresh, reducedMotion],
  );

  useImperativeHandle(ref, () => ({ onCompleted: handleCompleted }), [handleCompleted]);

  const dealNext = useCallback(() => {
    const lane = lanes[activeLane];
    if (lane === undefined) return;
    const length = queueLength(lane);
    if (length < 2) return;
    setDealOffsets((prev) => ({ ...prev, [lane.key]: ((prev[lane.key] ?? 0) + 1) % length }));
    setDockNonces((prev) => ({ ...prev, [lane.key]: (prev[lane.key] ?? 0) + 1 }));
  }, [lanes, activeLane]);

  /**
   * DEV-ONLY driver, sanctioned by issue #4: until the task drawer lands in
   * S4 there is no UI path that completes a task, so in dev builds pressing
   * "c" completes the active lane's dealt focus task via the complete_task
   * IPC with outcome "correct", then runs the same choreography S4/S5 will
   * trigger through `BoardHandle.onCompleted`. Remove with the S4 drawer.
   */
  const devComplete = useCallback((): boolean => {
    const lane = lanes[activeLane];
    if (lane === undefined) return false;
    const focus = displayedFocus(lane, dealOffsets[lane.key] ?? 0);
    if (focus === null) return false;
    void (async () => {
      const result = await completeTask(focus.id, "correct");
      const toast =
        result.capture !== null
          ? `● ${result.capture.name} — captured · resurfaces ${result.capture.next_display}`
          : // Dev-only fallback: with S1's store every completion carries a
            // capture, so this string is unreachable outside broken fixtures.
            `✓ ${result.task_id} done`;
      handleCompleted(focus.id, lane.key, toast);
    })().catch((cause: unknown) => console.error("dev complete failed", cause));
    return true;
  }, [lanes, activeLane, dealOffsets, handleCompleted]);

  useKeyLayer(KEY_PRIORITY.BOARD, (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (lanes.length === 0) return false;
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index >= lanes.length) return false;
      setActiveLane(index);
      return true;
    }
    if (event.key === "Tab") {
      dealNext();
      return true;
    }
    if (event.key === "Enter") {
      const lane = lanes[activeLane];
      if (lane === undefined) return false;
      const focus = displayedFocus(lane, dealOffsets[lane.key] ?? 0);
      if (focus === null) return false;
      onOpenTask(focus.id);
      return true;
    }
    if (import.meta.env.DEV && event.key === "c") {
      return devComplete();
    }
    return false;
  });

  const handleImportSeed = () => {
    void (async () => {
      await importGraph(seedRaw);
      await refresh();
    })().catch((cause: unknown) => console.error("seed import failed", cause));
  };

  if (lanes.length === 0) {
    // First-run empty state (issue #9's promise) — refined in S7/S8.
    return (
      <div className="sw-board-empty">
        <div className="sw-board-empty-card">
          <button type="button" className="sw-board-empty-btn" onClick={handleImportSeed}>
            load the launch graph
          </button>
          <div className="sw-board-empty-sub">or drop a doc — intake takes it from here</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sw-board">
      {lanes.map((lane, index) => {
        const laneAdvancing = advancing !== null && advancing.laneKey === lane.key;
        return (
          <Lane
            key={lane.key}
            lane={lane}
            focus={displayedFocus(lane, dealOffsets[lane.key] ?? 0)}
            active={index === activeLane}
            advancingTaskId={laneAdvancing ? advancing.taskId : null}
            dockNonce={dockNonces[lane.key] ?? 0}
            onSelect={() => setActiveLane(index)}
            onOpen={onOpenTask}
          />
        );
      })}
    </div>
  );
}
