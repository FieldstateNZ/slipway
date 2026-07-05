import { useCallback, useEffect, useRef, useState } from "react";

import { Board, type BoardHandle } from "./components/board/Board";
import { AppShell } from "./components/chrome/AppShell";
import { Drawer, type DrawerParkSnapshot } from "./components/drawer/Drawer";
import { LedgerOverlay } from "./components/ledger/LedgerOverlay";
import { MapOverlay } from "./components/map/MapOverlay";
import { RecheckCard, type QuizSource } from "./components/recheck/RecheckCard";
import { readySummary } from "./lib/board/present";
import { useBoard } from "./lib/board/useBoard";
import { getDueRecheck, getRecheck, resetAll } from "./lib/ipc/commands";
import type { CaptureResult, CompleteResult, DueRecheck } from "./lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "./lib/keys";
import { SettingsProvider } from "./lib/settings";

/** Footer toast lifetimes, from the prototype (5.2s default, 2.5s for reset). */
const TOAST_MS = 5200;
const RESET_TOAST_MS = 2500;

/** The full-screen overlays; at most one shows (prototype `state.overlay`). */
type OverlayKind = "map" | "ledger";

/** The quiz card on offer, plus where it came from. */
interface QuizState {
  recheck: DueRecheck;
  source: QuizSource;
}

/** Footer toast copy for a completed capture (prototype `finishTask`). */
function completionToast(result: CompleteResult, outcome: CaptureResult): string {
  // With S1's store every completion carries a capture; a null capture can
  // only mean there was nothing to grade, which reads as hollow.
  if (outcome === "hollow" || result.capture === null) {
    return `◌ ${result.task_id} done, left hollow — it will ask again`;
  }
  if (outcome === "correct") {
    return `● ${result.capture.name} — captured · resurfaces ${result.capture.next_display}`;
  }
  return `✕ ${result.capture.name} — the why is the win · back ~1d`;
}

function noop(): void {
  // Placeholder chrome handler until the intake slice (S7) wires real behavior.
}

function AppContent() {
  const { board, refresh } = useBoard();
  const [toast, setToast] = useState<string | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The open drawer, plus in-memory parked state per task id: Esc parks a
  // task without completing it, and reopening restores phase + step index.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const parkedDrawers = useRef(new Map<string, DrawerParkSnapshot>());
  const boardRef = useRef<BoardHandle>(null);

  // The overlays ("on demand, never home"): g toggles the map, l the ledger;
  // each overlay consumes Esc + its own key at OVERLAY priority to close.
  // version bumps force a refetch if state mutates while one is showing.
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [ledgerVersion, setLedgerVersion] = useState(0);

  // Recheck-in-passing: the single due recheck on offer, and the quiz card.
  const [dueRecheck, setDueRecheck] = useState<DueRecheck | null>(null);
  const [quiz, setQuiz] = useState<QuizState | null>(null);

  const drawerClosed = openTaskId === null;

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((text: string, durationMs: number = TOAST_MS) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), durationMs);
  }, []);

  const refreshDueRecheck = useCallback(async () => {
    try {
      setDueRecheck(await getDueRecheck());
    } catch (cause) {
      console.error("due recheck fetch failed", cause);
    }
  }, []);

  // The board fetch happens in useBoard; the due recheck needs its own
  // mount-time fetch so the footer slot can offer one before any mutation.
  useEffect(() => {
    void refreshDueRecheck();
  }, [refreshDueRecheck]);

  // Every board refresh also bumps the overlay versions (so an open map or
  // ledger repaints when state mutates underneath it) and re-asks for the
  // due recheck (completions seed new concepts).
  const refreshAll = useCallback(async () => {
    await refresh();
    setMapVersion((version) => version + 1);
    setLedgerVersion((version) => version + 1);
    await refreshDueRecheck();
  }, [refresh, refreshDueRecheck]);

  const handleReset = useCallback(() => {
    void (async () => {
      await resetAll();
      // Parked drawer snapshots would otherwise survive into the re-imported
      // graph (task ids are stable), restoring pre-reset progress. An open
      // quiz card would grade against wiped concepts — drop it too.
      parkedDrawers.current.clear();
      setOpenTaskId(null);
      setQuiz(null);
      await refreshAll();
      showToast("reset — fresh tide", RESET_TOAST_MS);
    })().catch((cause: unknown) => console.error("reset failed", cause));
  }, [refreshAll, showToast]);

  const handleOpenTask = useCallback((taskId: string) => {
    setOpenTaskId(taskId);
  }, []);

  const handlePark = useCallback(
    (snapshot: DrawerParkSnapshot | null) => {
      // A null snapshot (detail never loaded) keeps any earlier parked state.
      if (openTaskId !== null && snapshot !== null) {
        parkedDrawers.current.set(openTaskId, snapshot);
      }
      setOpenTaskId(null);
    },
    [openTaskId],
  );

  // The drawer's capture resolved and complete_task succeeded: close the
  // drawer, drop its parked snapshot (a completed task must never restore
  // stale state), and hand the board the choreography + exact toast copy.
  const handleComplete = useCallback(
    (result: CompleteResult, outcome: CaptureResult) => {
      parkedDrawers.current.delete(result.task_id);
      setOpenTaskId(null);
      const text = completionToast(result, outcome);
      const laneKey = board?.lanes.find(
        (lane) =>
          lane.focus?.id === result.task_id ||
          lane.queue.some((queued) => queued.id === result.task_id),
      )?.key;
      if (laneKey !== undefined) {
        // onCompleted toasts and refreshes (its refresh prop is refreshAll).
        boardRef.current?.onCompleted(result.task_id, laneKey, text);
      } else {
        // Lane no longer on the board (mutated underneath) — skip the
        // choreography but still toast and refresh.
        showToast(text);
        void refreshAll();
      }
    },
    [board, showToast, refreshAll],
  );

  const toggleOverlay = useCallback(
    (kind: OverlayKind) => {
      // Prototype: overlays never show over an open drawer.
      if (openTaskId === null) setOverlay((current) => (current === kind ? null : kind));
    },
    [openTaskId],
  );

  const closeOverlay = useCallback(() => setOverlay(null), []);

  const openDueRecheck = useCallback(() => {
    if (dueRecheck !== null) setQuiz({ recheck: dueRecheck, source: "recheck" });
  }, [dueRecheck]);

  // Ledger "ask me": fetch that concept's question regardless of due-ness.
  // The card renders over the open ledger (quiz z50 above overlay z30).
  const handleAsk = useCallback((conceptId: string) => {
    getRecheck(conceptId).then(
      (recheck) => setQuiz({ recheck, source: "ledger" }),
      (cause: unknown) => console.error("recheck fetch failed", cause),
    );
  }, []);

  const handleQuizAnswered = useCallback(() => {
    // Repaint an open ledger behind the card, and re-ask what's due next.
    setLedgerVersion((version) => version + 1);
    void refreshDueRecheck();
  }, [refreshDueRecheck]);

  // Prototype `recheckOn` (line 606): the footer offers the recheck only
  // when nothing else is talking — no toast, drawer, overlay, or quiz card.
  const recheckSlot =
    dueRecheck !== null && toast === undefined && drawerClosed && overlay === null && quiz === null
      ? { label: `20s recheck — ${dueRecheck.name} ◌`, onOpen: openDueRecheck }
      : undefined;

  // App owns the overlay/recheck-opening keys at BOARD priority; while an
  // overlay is open its own OVERLAY layer consumes Esc + its toggle key, and
  // the other open keys go dead (prototype: only close keys work then). The
  // quiz card consumes everything at QUIZ priority while it shows.
  useKeyLayer(
    KEY_PRIORITY.BOARD,
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (overlay !== null) return false;
      if (event.key === "g") {
        toggleOverlay("map");
        return true;
      }
      if (event.key === "l") {
        toggleOverlay("ledger");
        return true;
      }
      if (event.key === "r" && recheckSlot !== undefined) {
        openDueRecheck();
        return true;
      }
      return false;
    },
    drawerClosed && quiz === null,
  );

  return (
    <AppShell
      readySummary={board !== null ? readySummary(board) : "0 ready · 0m"}
      onIntake={noop}
      onLearned={() => toggleOverlay("ledger")}
      onMap={() => toggleOverlay("map")}
      toast={toast}
      recheck={recheckSlot}
      onReset={handleReset}
    >
      {board !== null && (
        <Board
          ref={boardRef}
          board={board}
          refresh={refreshAll}
          onOpenTask={handleOpenTask}
          onToast={showToast}
          keysEnabled={drawerClosed && overlay === null && quiz === null}
        />
      )}
      <MapOverlay open={overlay === "map"} onClose={closeOverlay} version={mapVersion} />
      <LedgerOverlay
        open={overlay === "ledger"}
        onClose={closeOverlay}
        version={ledgerVersion}
        onAsk={handleAsk}
      />
      {openTaskId !== null && (
        <Drawer
          key={openTaskId}
          taskId={openTaskId}
          restored={parkedDrawers.current.get(openTaskId) ?? null}
          onPark={handlePark}
          onComplete={handleComplete}
        />
      )}
      {quiz !== null && (
        <RecheckCard
          key={`${quiz.source}-${quiz.recheck.concept_id}`}
          recheck={quiz.recheck}
          source={quiz.source}
          onClose={() => setQuiz(null)}
          onAnswered={handleQuizAnswered}
        />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}
