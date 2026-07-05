// Mirror types for the IPC payloads defined in `crates/slipway-core/src/model.rs`.
// Field names match the Rust serde output exactly (snake_case).

/** Who executes a task. */
export type Owner = "you" | "atlas" | "pipeline";

/** What shape of work a task is. */
export type TaskKind = "action" | "decision" | "provide";

/** Outcome of a capture question when completing a task. */
export type CaptureResult = "correct" | "miss" | "hollow";

/** The focus card dealt to a lane. */
export interface FocusCard {
  id: string;
  kind: TaskKind;
  effort_min: number;
  in_progress: boolean;
  title: string;
  short: string;
  sub: string;
  frees: string;
}

/** One project lane. */
export interface LaneView {
  key: string;
  name: string;
  full_name: string;
  custom: boolean;
  /** The default deal — always `queue[0] ?? null`. */
  focus: FocusCard | null;
  /** Full ready-you queue (in_progress first, then pr); Tab-deal cycles it client-side. */
  queue: FocusCard[];
  others_behind: number;
  remaining_effort_min: number;
}

/** Everything the board needs to paint the lanes and the titlebar summary. */
export interface BoardView {
  lanes: LaneView[];
  ready_count: number;
  ready_effort_min: number;
}

/** One step inside the task drawer. */
export interface StepView {
  text: string;
  cmd: string | null;
  concept_label: string | null;
  concept_text: string | null;
}

/** One option of a decision task. */
export interface DecisionOptionView {
  title: string;
  body: string;
}

/**
 * The capture question shown at completion. `correct_index` ships to the
 * frontend on purpose: this is a local-first app and the drawer grades locally.
 */
export interface CaptureView {
  question: string;
  choices: string[];
  correct_index: number;
  why: string;
}

/** Full detail for the task drawer. */
export interface TaskDetail {
  id: string;
  kind: TaskKind;
  effort_min: number;
  title: string;
  sub: string;
  frees: string;
  project_full_name: string;
  before: string;
  steps: StepView[];
  decision_options: DecisionOptionView[];
  capture: CaptureView;
}

/** One row of the learning ledger, in first-capture order. */
export interface LedgerRow {
  concept_id: string;
  name: string;
  from_task: string;
  /** Uncapped in storage; the UI caps display at 4. */
  streak: number;
  hollow: boolean;
  next_display: string;
  has_question: boolean;
}

/** The single most-overdue recheck on offer. */
export interface DueRecheck {
  concept_id: string;
  name: string;
  question: string;
  choices: string[];
  correct_index: number;
  why: string;
}

/** Result of answering a recheck. */
export interface RecheckOutcome {
  correct: boolean;
  streak: number;
  next_display: string;
}

/** Ledger delta produced by completing a task's capture question. */
export interface ConceptCaptureView {
  concept_id: string;
  name: string;
  streak: number;
  hollow: boolean;
  next_display: string;
}

/** Result of completing a task. */
export interface CompleteResult {
  task_id: string;
  capture: ConceptCaptureView | null;
}
