import { buttonLabel, focusMeta } from "../../lib/board/present";
import type { FocusCard as FocusCardData } from "../../lib/ipc/types";
import "./board.css";

export interface FocusCardProps {
  focus: FocusCardData;
  /** Lane is the active (keyboard-selected) lane. */
  active: boolean;
  /** Play the swDockIn animation (fresh deal or post-completion advance). */
  docking: boolean;
  onOpen: () => void;
}

/** The one focus card a lane deals — never a list. */
export function FocusCard({ focus, active, docking, onOpen }: FocusCardProps) {
  const meta = focusMeta(focus);
  const classes = ["sw-focus"];
  if (active || focus.in_progress) classes.push("sw-focus-accent");
  if (active) classes.push("sw-focus-active");
  if (docking) classes.push("sw-focus-dock");
  return (
    <div className={classes.join(" ")} onClick={onOpen}>
      <div className={meta.accent ? "sw-focus-meta sw-focus-meta-accent" : "sw-focus-meta"}>
        {meta.text}
      </div>
      <div className="sw-focus-title">{focus.short}</div>
      <div className="sw-focus-sub">{focus.sub}</div>
      <div className="sw-focus-row">
        {/* Clicks bubble to the card's onOpen — the button is not a separate action. */}
        <button
          type="button"
          className={active ? "sw-focus-btn sw-focus-btn-active" : "sw-focus-btn"}
        >
          {buttonLabel(focus)}
        </button>
        <div className="sw-focus-frees">{focus.frees}</div>
      </div>
    </div>
  );
}
