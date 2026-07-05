import { useCallback, useEffect, useRef, useState } from "react";

import { Board } from "./components/board/Board";
import { AppShell } from "./components/chrome/AppShell";
import { Drawer, type DrawerParkSnapshot } from "./components/drawer/Drawer";
import { readySummary } from "./lib/board/present";
import { useBoard } from "./lib/board/useBoard";
import { resetAll } from "./lib/ipc/commands";
import { SettingsProvider } from "./lib/settings";

/** Footer toast lifetimes, from the prototype (5.2s default, 2.5s for reset). */
const TOAST_MS = 5200;
const RESET_TOAST_MS = 2500;

function noop(): void {
  // Placeholder chrome handlers until the overlay slices (S5–S7) wire real behavior.
}

function AppContent() {
  const { board, refresh } = useBoard();
  const [toast, setToast] = useState<string | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The open drawer, plus in-memory parked state per task id: Esc parks a
  // task without completing it, and reopening restores phase + step index.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const parkedDrawers = useRef(new Map<string, DrawerParkSnapshot>());

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((text: string, durationMs: number = TOAST_MS) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), durationMs);
  }, []);

  const handleReset = useCallback(() => {
    void (async () => {
      await resetAll();
      await refresh();
      showToast("reset — fresh tide", RESET_TOAST_MS);
    })();
  }, [refresh, showToast]);

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

  return (
    <AppShell
      readySummary={board !== null ? readySummary(board) : "0 ready · 0m"}
      onIntake={noop}
      onLearned={noop}
      onMap={noop}
      toast={toast}
      onReset={handleReset}
    >
      {board !== null && (
        <Board board={board} refresh={refresh} onOpenTask={handleOpenTask} onToast={showToast} />
      )}
      {openTaskId !== null && (
        <Drawer
          key={openTaskId}
          taskId={openTaskId}
          restored={parkedDrawers.current.get(openTaskId) ?? null}
          onPark={handlePark}
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
