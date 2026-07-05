// Thin typed wrappers over the Tauri commands defined in `src-tauri/src/lib.rs`.
// Commands use `rename_all = "snake_case"`, so argument keys stay snake_case.

import { invoke } from "@tauri-apps/api/core";

import type {
  BoardView,
  CaptureResult,
  CompleteResult,
  DueRecheck,
  LedgerRow,
  RecheckOutcome,
  TaskDetail,
} from "./types";

/** Per-lane board data plus the app-level ready summary. */
export function getBoard(): Promise<BoardView> {
  return invoke("get_board");
}

/** Full drawer detail for a task. */
export function getTaskDetail(taskId: string): Promise<TaskDetail> {
  return invoke("get_task_detail", { task_id: taskId });
}

/**
 * Mark a task done, record the decision choice if any, and append the
 * capture outcome to the loop's concept.
 */
export function completeTask(
  taskId: string,
  outcome: CaptureResult,
  decisionChoice?: number,
): Promise<CompleteResult> {
  return invoke("complete_task", {
    task_id: taskId,
    outcome,
    decision_choice: decisionChoice ?? null,
  });
}

/** Ledger rows in first-capture order. */
export function getLedger(): Promise<LedgerRow[]> {
  return invoke("get_ledger");
}

/** The single most-overdue recheck, or null when nothing is due. */
export function getDueRecheck(): Promise<DueRecheck | null> {
  return invoke("get_due_recheck");
}

/** Grade a recheck answer; returns whether it was right plus the updated "next" display. */
export function answerRecheck(conceptId: string, choiceIndex: number): Promise<RecheckOutcome> {
  return invoke("answer_recheck", { concept_id: conceptId, choice_index: choiceIndex });
}

/** Import a graph JSON payload (same schema as `seed/launch-graph.json`). */
export function importGraph(jsonString: string): Promise<void> {
  return invoke("import_graph", { json_string: jsonString });
}

/** Wipe all rows (footer reset). */
export function resetAll(): Promise<void> {
  return invoke("reset_all");
}
