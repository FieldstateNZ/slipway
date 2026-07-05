import { useCallback, useEffect, useRef, useState } from "react";

import { Board } from "./components/board/Board";
import { AppShell } from "./components/chrome/AppShell";
import { Drawer, type DrawerParkSnapshot } from "./components/drawer/Drawer";
import { MapOverlay } from "./components/map/MapOverlay";
import { readySummary } from "./lib/board/present";
import { useBoard } from "./lib/board/useBoard";
import { resetAll } from "./lib/ipc/commands";
import { KEY_PRIORITY, useKeyLayer } from "./lib/keys";
import { SettingsProvider } from "./lib/settings";

/** Footer toast lifetimes, from the prototype (5.2s default, 2.5s for reset). */
const TOAST_MS = 5200;
const RESET_TOAST_MS = 2500;

function noop(): void {
  // Placeholder chrome handlers until the overlay slices (S5, S7) wire real behavior.
}

function AppContent() {
  const { board, refresh } = useBoard();
  const [toast, setToast] = useState<string | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The open drawer, plus in-memory parked state per task id: Esc parks a
  // task without completing it, and reopening restores phase + step index.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const parkedDrawers = useRef(new Map<string, DrawerParkSnapshot>());

  // The map overlay ("on demand, never home"): g toggles it; the overlay
  // itself consumes Esc/g to close at OVERLAY priority. version bumps force
  // a refetch if the graph mutates while the map is showing.
  const [mapOpen, setMapOpen] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const drawerClosed = openTaskId === null;

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((text: string, durationMs: number = TOAST_MS) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), durationMs);
  }, []);

  // Every board refresh also bumps the map version, so an open map repaints
  // when the graph mutates underneath it (issue #7: live updates).
  const refreshAll = useCallback(async () => {
    await refresh();
    setMapVersion((version) => version + 1);
  }, [refresh]);

  const handleReset = useCallback(() => {
    void (async () => {
      await resetAll();
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

  const toggleMap = useCallback(() => {
    // Prototype: overlays never show over an open drawer.
    if (openTaskId === null) setMapOpen((open) => !open);
  }, [openTaskId]);

  // App owns the overlay-opening keys at BOARD priority; while an overlay is
  // open its own OVERLAY layer consumes Esc/g first (toggle-close).
  useKeyLayer(
    KEY_PRIORITY.BOARD,
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (event.key === "g") {
        toggleMap();
        return true;
      }
      return false;
    },
    drawerClosed,
  );

  return (
    <AppShell
      readySummary={board !== null ? readySummary(board) : "0 ready · 0m"}
      onIntake={noop}
      onLearned={noop}
      onMap={toggleMap}
      toast={toast}
      onReset={handleReset}
    >
      {board !== null && (
        <Board
          board={board}
          refresh={refreshAll}
          onOpenTask={handleOpenTask}
          onToast={showToast}
          keysEnabled={drawerClosed && !mapOpen}
        />
      )}
      <MapOverlay open={mapOpen} onClose={() => setMapOpen(false)} version={mapVersion} />
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
