// Thin server-state hook for the board: fetch once on mount, refetch on demand.
// Components take the data via props so they stay unit-testable without IPC.

import { useCallback, useEffect, useState } from "react";

import { getBoard } from "../ipc/commands";
import type { BoardView } from "../ipc/types";

export interface UseBoardResult {
  /** Null until the first `get_board` resolves. */
  board: BoardView | null;
  /** Refetch the board; mutating actions (import, complete, reset) call this. */
  refresh: () => Promise<void>;
}

export function useBoard(): UseBoardResult {
  const [board, setBoard] = useState<BoardView | null>(null);

  const refresh = useCallback(async () => {
    const next = await getBoard();
    setBoard(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { board, refresh };
}
