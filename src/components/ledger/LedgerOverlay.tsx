import { useEffect, useState } from "react";

import { getLedger } from "../../lib/ipc/commands";
import type { LedgerRow } from "../../lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import "./ledger.css";

/** Streak display caps at 4 blocks; storage is uncapped. */
const STREAK_BLOCKS = 4;

export interface LedgerOverlayProps {
  /** Render (and fetch) the overlay. The component renders null when closed. */
  open: boolean;
  /**
   * Close request — fired by Esc, "l" (the prototype's toggle), and the
   * header "esc ✕". App owns the "l" open key at the BOARD layer.
   */
  onClose: () => void;
  /**
   * Live-update trigger: bump after any ledger mutation (a completion, a
   * recheck answer) to refetch while the overlay is open. It also refetches
   * on every open.
   */
  version?: number;
  /** "ask me" — open the ledger-sourced quiz card for this concept. */
  onAsk: (conceptId: string) => void;
}

/** The Learned ledger overlay — evidence, not homework. */
export function LedgerOverlay({ open, onClose, version = 0, onAsk }: LedgerOverlayProps) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on every open (and on version bumps while open) so the ledger
  // always reflects captures and recheck answers — the previous payload
  // keeps painting for the few ms the fetch takes, avoiding a flicker.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    getLedger().then(
      (next) => {
        if (!stale) {
          setRows(next);
          setError(null);
        }
      },
      (cause: unknown) => {
        console.error("ledger fetch failed", cause);
        // Surface the failure instead of silently painting stale rows.
        if (!stale) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      stale = true;
    };
  }, [open, version]);

  useKeyLayer(
    KEY_PRIORITY.OVERLAY,
    (event) => {
      if (event.key === "Escape" || event.key === "l") {
        onClose();
        return true;
      }
      return false;
    },
    open,
  );

  if (!open) return null;

  const shown = rows ?? [];
  const held = shown.filter((row) => row.streak > 0 && !row.hollow).length;
  const hollows = shown.filter((row) => row.hollow).length;

  return (
    <div className="sw-ledger">
      <div className="sw-ledger-head">
        <span className="sw-ledger-title">Learned</span>
        <span className="sw-ledger-summary">
          {shown.length} · {held} held · {hollows} hollow ◌
        </span>
        <span className="sw-ledger-spacer" />
        <button type="button" className="sw-ledger-close" onClick={onClose}>
          esc ✕
        </button>
      </div>
      <div className="sw-ledger-tagline">
        Evidence, not homework — rechecks ride along on the board.
      </div>
      <div className="sw-ledger-body">
        {error !== null && (
          <div className="sw-ledger-error">couldn’t load the ledger — {error}</div>
        )}
        {shown.map((row) => {
          const fill = Math.min(row.streak, STREAK_BLOCKS);
          return (
            <div className="sw-ledger-row" key={row.concept_id}>
              <div className="sw-ledger-row-top">
                <span className={"sw-ledger-name" + (row.hollow ? " sw-ledger-name-hollow" : "")}>
                  {row.hollow ? `◌ ${row.name}` : row.name}
                </span>
                <span className="sw-ledger-streak">
                  <span className="sw-ledger-streak-fill">{"▮".repeat(fill)}</span>
                  <span className="sw-ledger-streak-rest">{"▮".repeat(STREAK_BLOCKS - fill)}</span>
                </span>
              </div>
              <div className="sw-ledger-row-sub">
                <span className="sw-ledger-from">
                  {row.from_task} · {row.next_display}
                </span>
                <span className="sw-ledger-row-spacer" />
                {row.has_question && (
                  <button
                    type="button"
                    className="sw-ledger-ask"
                    onClick={() => onAsk(row.concept_id)}
                  >
                    ask me
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sw-ledger-footer">
        hollow rings ◌ queue the same one-tap question — no quiz screens anywhere
      </div>
    </div>
  );
}
