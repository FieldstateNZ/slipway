// Thin server-state hook for the board: fetch once on mount, refetch on demand.
// Components take the data via props so they stay unit-testable without IPC.

import { useCallback, useEffect, useRef, useState } from "react";

import { getBoard } from "../ipc/commands";
import type { BoardView } from "../ipc/types";

export interface UseBoardResult {
  /** Null until the first `get_board` resolves. */
  board: BoardView | null;
  /** Refetch the board; mutating actions (import, complete, reset) call this. */
  refresh: () => Promise<void>;
  /** Message from the most recent failed fetch; null once one succeeds. */
  error: string | null;
}

export function useBoard(): UseBoardResult {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic ticket: only the newest in-flight refresh may commit, so an
  // older response resolving late can never paint stale state over a newer one.
  const ticket = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const next = await getBoard();
      if (ticket.current === mine) {
        setBoard(next);
        setError(null);
      }
    } catch (cause) {
      if (ticket.current === mine) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { board, refresh, error };
}
