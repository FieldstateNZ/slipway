// Pure presentation derivations for the board — no React, no IPC.
// Every string is copied character-for-character from the design prototype
// (docs/design/project/"Slipway Sidebar.dc.html", laneFor/renderVals).

import type { BoardView, FocusCard, LaneView } from "../ipc/types";

/** Lane header name color: the active lane reads secondary, the rest muted. */
export function laneNameColor(active: boolean): string {
  return active ? "var(--sw-text-secondary)" : "var(--sw-text-muted)";
}

/** Accent label shown in the lane header while the completion pill slides out. */
export function advLabel(advancing: boolean): string {
  return advancing ? "advancing…" : "";
}

/** The faint queue whisper at the right of the lane header. */
export function queueWhisper(lane: LaneView, advancing: boolean): string {
  if (advancing) return "";
  if (lane.key === "sw") {
    return lane.focus !== null ? "then atlas → pipeline → you" : "";
  }
  const suffix = lane.custom ? " — imported" : " to launch";
  if (lane.others_behind > 0) {
    return `${lane.others_behind} behind · ≈${lane.remaining_effort_min}m${suffix}`;
  }
  if (lane.remaining_effort_min > 0) {
    return `≈${lane.remaining_effort_min}m${suffix}`;
  }
  return "yours done — others finishing";
}

export interface FocusMeta {
  text: string;
  /** In-progress meta renders in the accent color; everything else muted. */
  accent: boolean;
}

/** The mono meta line above the focus card title. */
export function focusMeta(focus: FocusCard): FocusMeta {
  if (focus.in_progress) {
    return { text: "● in progress — this session", accent: true };
  }
  const effort = focus.effort_min > 0 ? `${focus.effort_min}m` : "ongoing";
  const kind =
    focus.kind === "decision" ? " · decision" : focus.kind === "provide" ? " · provide" : "";
  return { text: `next · ${effort}${kind}`, accent: false };
}

/** Label for the focus card's primary button. */
export function buttonLabel(focus: FocusCard): string {
  if (focus.in_progress) return "Continue ↵";
  if (focus.kind === "decision") return "Decide ↵";
  if (focus.kind === "provide") return "Hand over ↵";
  return "Start ↵";
}

/** Waiting card title — the same for every lane. */
export const WAIT_TITLE = "Nothing needs you here";

const WAIT_SUBS: Record<string, string> = {
  ds: "▸ ▸ ▸  atlas is finishing — marketing copy",
  lm: "▸ ▸ ▸  pipeline carries it — staging + harness next",
  sw: "▸ ▸ ▸  atlas takes it — spec + backlog",
};

const WAIT_SUB_CUSTOM = "▸ ▸ ▸  all done — archive it";

/** Waiting card subtitle, per project. Custom (imported) lanes get the archive line. */
export function waitSub(lane: LaneView): string {
  if (lane.custom) return WAIT_SUB_CUSTOM;
  return WAIT_SUBS[lane.key] ?? WAIT_SUB_CUSTOM;
}

/** Titlebar summary, e.g. "4 ready · 35m". */
export function readySummary(board: BoardView): string {
  return `${board.ready_count} ready · ${board.ready_effort_min}m`;
}

/** Ready owner-you queue length for a lane. */
export function queueLength(lane: LaneView): number {
  return lane.queue.length;
}

/** The one card the lane deals, honoring the client-side deal offset. */
export function displayedFocus(lane: LaneView, dealOffset: number): FocusCard | null {
  if (lane.queue.length === 0) return null;
  return lane.queue[dealOffset % lane.queue.length] ?? null;
}
