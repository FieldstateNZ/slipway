import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import seedRaw from "../../../seed/launch-graph.json?raw";
import { displayedFocus, queueLength } from "../../lib/board/present";
import { importGraph } from "../../lib/ipc/commands";
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
  /**
   * Activate the lane with this project key (S7 intake confirm). The key is
   * held until the lane exists on the board, so calling right after a
   * refresh — before the new lane's props have landed — still selects it.
   */
  selectLane: (key: string) => void;
}

export interface BoardProps {
  board: BoardView;
  refresh: () => Promise<void>;
  /** Open the task drawer (no-op until S4). */
  onOpenTask: (taskId: string) => void;
  /** Send toast text to the footer slot (App owns the timeout). */
  onToast: (toast: string) => void;
  /**
   * Gate for the board key layer. The prototype ignores every board key while
   * a drawer or overlay is open (its handleKey returns inside those branches),
   * so App disables this layer instead of relying on fall-through.
   */
  keysEnabled?: boolean;
  ref?: Ref<BoardHandle>;
}

/** The home surface: lanes of one. */
export function Board({
  board,
  refresh,
  onOpenTask,
  onToast,
  keysEnabled = true,
  ref,
}: BoardProps) {
  const { reducedMotion } = useSettings();
  const lanes = board.lanes;

  const [activeLane, setActiveLane] = useState(0);
  const [dealOffsets, setDealOffsets] = useState<Record<string, number>>({});
  const [dockNonces, setDockNonces] = useState<Record<string, number>>({});
  const [advancing, setAdvancing] = useState<{ laneKey: string; taskId: string } | null>(null);
  const [pendingLaneKey, setPendingLaneKey] = useState<string | null>(null);
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
      setPendingLaneKey(null);
    } else if (activeLane >= lanes.length) {
      setActiveLane(0);
    }
  }, [lanes.length, activeLane]);

  // Resolve a requested lane key once the lane is actually on the board
  // (intake's selectLane can land before the refreshed lanes prop does).
  useEffect(() => {
    if (pendingLaneKey === null) return;
    const index = lanes.findIndex((lane) => lane.key === pendingLaneKey);
    if (index !== -1) {
      setActiveLane(index);
      setPendingLaneKey(null);
    }
  }, [lanes, pendingLaneKey]);

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

  useImperativeHandle(
    ref,
    () => ({ onCompleted: handleCompleted, selectLane: setPendingLaneKey }),
    [handleCompleted],
  );

  const dealNext = useCallback(() => {
    const lane = lanes[activeLane];
    if (lane === undefined) return;
    const length = queueLength(lane);
    if (length < 2) return;
    setDealOffsets((prev) => ({ ...prev, [lane.key]: ((prev[lane.key] ?? 0) + 1) % length }));
    setDockNonces((prev) => ({ ...prev, [lane.key]: (prev[lane.key] ?? 0) + 1 }));
  }, [lanes, activeLane]);

  useKeyLayer(
    KEY_PRIORITY.BOARD,
    (event) => {
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
      return false;
    },
    keysEnabled,
  );

  const handleImportSeed = () => {
    void (async () => {
      await importGraph(seedRaw);
      await refresh();
    })().catch((cause: unknown) => console.error("seed import failed", cause));
  };

  if (lanes.length === 0) {
    // First-run empty state (issue #9: never a blank wall) — also what the
    // footer reset lands on. Both entry paths are on offer: the seed graph,
    // or straight to intake ('i' works here — App owns that key).
    return (
      <div className="sw-board-empty">
        <div className="sw-board-empty-card">
          <button type="button" className="sw-board-empty-btn" onClick={handleImportSeed}>
            load the launch graph
          </button>
          <div className="sw-board-empty-sub">or go straight to intake — drop a doc / press i</div>
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
