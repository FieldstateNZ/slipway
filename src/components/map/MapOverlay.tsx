import { Fragment, useEffect, useState } from "react";

import { getMap } from "../../lib/ipc/commands";
import type { MapView, PillView } from "../../lib/ipc/types";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import "./map.css";

export interface MapOverlayProps {
  /** Render (and fetch) the overlay. The component renders null when closed. */
  open: boolean;
  /**
   * Close request — fired by Esc, "g" (the prototype's toggle), and the
   * header "esc ✕". App owns the "g" open key at the BOARD layer.
   */
  onClose: () => void;
  /**
   * Live-update trigger: bump this counter after any mutation (e.g. a task
   * completion) to refetch while the map is open. The overlay also refetches
   * on every open, so App only needs `version` for changes that can land
   * while the map is showing.
   */
  version?: number;
}

/** The design's exact truncation: `short.length > 22 ? short.slice(0, 21) + "…" : short`. */
function truncated(short: string): string {
  return short.length > 22 ? short.slice(0, 21) + "…" : short;
}

/** Pill copy, mirroring the prototype's `chainPill`. */
function pillLabel(pill: PillView): string {
  if (pill.flag) return `⚑ ${pill.task_id}`;
  if (pill.done) return `✓ ${pill.task_id}`;
  const base = `${pill.task_id} · ${truncated(pill.short)}`;
  return pill.owner === "you" ? base : `${base} · ${pill.owner}`;
}

/** State precedence mirrors `chainPill`: flag → done → other owner → ready → waiting. */
function pillClass(pill: PillView): string {
  if (pill.flag) return "sw-map-pill sw-map-pill-flag";
  if (pill.done) return "sw-map-pill sw-map-pill-done";
  if (pill.owner !== "you") return "sw-map-pill sw-map-pill-other";
  if (pill.ready) return "sw-map-pill sw-map-pill-ready";
  return "sw-map-pill sw-map-pill-waiting";
}

/** The map overlay — dependency chains as pill rows. On demand, never home. */
export function MapOverlay({ open, onClose, version = 0 }: MapOverlayProps) {
  const [map, setMap] = useState<MapView | null>(null);

  // Refetch on every open (and on version bumps while open) so the map
  // always reflects completions — the previous payload keeps painting for
  // the few ms the fetch takes, avoiding a flicker on reopen.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void getMap().then((next) => {
      if (!stale) setMap(next);
    });
    return () => {
      stale = true;
    };
  }, [open, version]);

  useKeyLayer(
    KEY_PRIORITY.OVERLAY,
    (event) => {
      if (event.key === "Escape" || event.key === "g") {
        onClose();
        return true;
      }
      return false;
    },
    open,
  );

  if (!open) return null;

  return (
    <div className="sw-map">
      <div className="sw-map-head">
        <span className="sw-map-title">The map</span>
        <span className="sw-map-tag">on demand, never home</span>
        <span className="sw-map-spacer" />
        <button type="button" className="sw-map-close" onClick={onClose}>
          esc ✕
        </button>
      </div>
      <div className="sw-map-legend">lit = ready · dashed = waiting · ✓ = done</div>
      <div className="sw-map-body">
        {(map?.chains ?? []).map((chain, chainIndex) => (
          <div className="sw-map-chain" key={`${chainIndex}-${chain.label}`}>
            <div className="sw-map-chain-label">{chain.label}</div>
            <div className="sw-map-row">
              {chain.pills.map((pill, pillIndex) => (
                <Fragment key={`${pillIndex}-${pill.task_id}`}>
                  {pillIndex > 0 && <span className="sw-map-arrow">→</span>}
                  <span className={pillClass(pill)}>{pillLabel(pill)}</span>
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
