import {
  WAIT_TITLE,
  advLabel,
  laneNameColor,
  queueWhisper,
  waitSub,
} from "../../lib/board/present";
import type { FocusCard as FocusCardData, LaneView } from "../../lib/ipc/types";
import { FocusCard } from "./FocusCard";
import { WaitingCard } from "./WaitingCard";
import "./board.css";

export interface LaneProps {
  lane: LaneView;
  /** The card currently dealt to this lane (deal offset already applied). */
  focus: FocusCardData | null;
  active: boolean;
  /** Task id sliding out in the ✓ pill while this lane advances, else null. */
  advancingTaskId: string | null;
  /** Bumped on each deal so the dock-in animation replays via the card key. */
  dockNonce: number;
  onSelect: () => void;
  onOpen: (taskId: string) => void;
}

/** One project lane: header row plus exactly one focus or waiting card. */
export function Lane({
  lane,
  focus,
  active,
  advancingTaskId,
  dockNonce,
  onSelect,
  onOpen,
}: LaneProps) {
  const advancing = advancingTaskId !== null;
  return (
    <div className="sw-lane" onClick={onSelect}>
      <div className="sw-lane-head">
        <span className="sw-lane-name" style={{ color: laneNameColor(active) }}>
          {lane.name}
        </span>
        <span className="sw-lane-head-spacer" />
        <span className="sw-lane-whisper">{queueWhisper(lane, advancing)}</span>
        {advancing && <span className="sw-lane-adv">{advLabel(true)}</span>}
      </div>
      {focus !== null ? (
        <FocusCard
          key={`${focus.id}:${dockNonce}`}
          focus={focus}
          active={active}
          // Known tradeoff: after the first deal this stays true, so a
          // focus-id remount outside an advance replays swDockIn. In v0.1
          // focus only changes via deal/advance, so the replay is unreachable;
          // revisit if cross-lane freeing ever swaps a focus card in place.
          docking={advancing || dockNonce > 0}
          onOpen={() => onOpen(focus.id)}
        />
      ) : (
        <WaitingCard title={WAIT_TITLE} sub={waitSub(lane)} />
      )}
      {advancing && (
        <div className="sw-lane-pill">
          {`✓ ${advancingTaskId}`}
          <span className="sw-lane-pill-dashes">˗˗˗</span>
        </div>
      )}
    </div>
  );
}
