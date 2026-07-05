// Pure builders turning intake input into the import-graph JSON that
// `import_graph` accepts (same schema as seed/launch-graph.json, version 1).
// All drop-path strings are copied character-for-character from the design
// prototype (docs/design/project/"Slipway Sidebar.dc.html", confirmIntake /
// intakeCap).

import type { Owner, TaskKind } from "../ipc/types";
import { baseName, type TaskStub } from "./atlas";

// -- import-graph schema (mirrors crates/slipway-core/src/import.rs) --------

export interface GraphProject {
  key: string;
  name: string;
  full_name: string;
  custom: boolean;
}

export interface GraphConcept {
  id: string;
  name: string;
  resurface_hint: string;
}

export interface GraphStep {
  idx: number;
  text: string;
  cmd: string | null;
  concept_label: string | null;
  concept_text: string | null;
}

export interface GraphCapture {
  concept_id: string;
  question: string;
  choices: string[];
  correct_index: number;
  why: string;
}

export interface GraphDecisionOption {
  idx: number;
  title: string;
  body: string;
}

export interface GraphLearn {
  before: string;
  steps: GraphStep[];
  decision_options: GraphDecisionOption[];
  capture: GraphCapture;
}

export interface GraphTask {
  id: string;
  project: string;
  pr: number;
  owner: Owner;
  kind: TaskKind;
  effort_min: number;
  deps: string[];
  title: string;
  short: string;
  sub: string;
  frees: string;
  in_progress: boolean;
  learn: GraphLearn | null;
}

export interface GraphPayload {
  version: 1;
  projects: GraphProject[];
  concepts: GraphConcept[];
  tasks: GraphTask[];
  /** Intake never seeds ledger history — always empty. */
  seed_learned: unknown[];
}

// -- fixed intake copy -------------------------------------------------------

/**
 * The `intake` concept every imported learn-loop captures against. It must
 * ship in every intake payload: the learn_loop row has a foreign key to it.
 */
export const INTAKE_CONCEPT: GraphConcept = {
  id: "intake",
  name: "intake learn-loops",
  resurface_hint: "~4d",
};

/** The prototype's `intakeCap` — one question shared by every imported task. */
export const INTAKE_CAPTURE: GraphCapture = {
  concept_id: "intake",
  question: "Who writes the learn-loop for imported tasks?",
  choices: [
    "You, by hand, before starting",
    "Atlas drafts it from the source doc; you skim and go",
    "It must be written in the original document",
    "Imported tasks don’t get one",
  ],
  correct_index: 1,
  why: "Intake is the mouth; Atlas chews. You only skim.",
};

/** The placeholder learn loop stamped on every task imported from a doc. */
function placeholderLearn(sourceName: string): GraphLearn {
  return {
    before: `Imported from ${sourceName}. Atlas drafts the full learn-loop from the source; this shell is ready to run now.`,
    steps: [
      {
        idx: 0,
        text: `Open ${sourceName} and confirm the scope`,
        cmd: null,
        concept_label: null,
        concept_text: null,
      },
      {
        idx: 1,
        text: "Do it — notes land back on this card",
        cmd: null,
        concept_label: null,
        concept_text: null,
      },
    ],
    decision_options: [],
    capture: INTAKE_CAPTURE,
  };
}

// -- builders ----------------------------------------------------------------

/**
 * Build the import payload for a confirmed drop: one new custom INBOX
 * project whose tasks are the (possibly edited) stubs, chained in order.
 * `existingCustomCount` is the number of custom lanes already on the board
 * (the prototype's `customProjects.length`) — the new key is `in{N+1}`.
 */
export function buildIntakePayload(
  stubs: TaskStub[],
  sourceName: string,
  existingCustomCount: number,
): GraphPayload {
  const key = `in${existingCustomCount + 1}`;
  const base = baseName(sourceName);
  const project: GraphProject = {
    key,
    name: `INBOX — ${base}`.toUpperCase().slice(0, 30),
    full_name: "inbox",
    custom: true,
  };
  const tasks = stubs.map((stub, i): GraphTask => ({
    id: `${key}-${i + 1}`,
    project: key,
    pr: i + 1,
    owner: "you",
    kind: stub.kind,
    effort_min: stub.effortMin,
    deps: i === 0 ? [] : [`${key}-${i}`],
    title: stub.title,
    short: stub.title,
    sub: "imported — refine as you go",
    frees: i < stubs.length - 1 ? `frees ${key}-${i + 2}` : "",
    in_progress: false,
    learn: placeholderLearn(sourceName),
  }));
  return { version: 1, projects: [project], concepts: [INTAKE_CONCEPT], tasks, seed_learned: [] };
}

export interface ManualTaskInput {
  /** Key of the existing lane the task joins (import upserts by id, so the id gets a fresh nonce). */
  projectKey: string;
  title: string;
  /** Manual entry is restricted to action/provide — decisions need options. */
  kind: Exclude<TaskKind, "decision">;
  effortMin: number;
  /** Optional dependencies on existing task ids. */
  deps: string[];
  /** Uniqueness nonce for the task id — caller supplies it so this stays pure. */
  nonce: string;
}

/**
 * Build the import payload for one manually entered task appended to an
 * existing project. The project row is NOT included (it already exists;
 * import merges), but the intake concept is — the learn loop's FK needs it.
 * `pr: 999` docks the task at the back of the lane's queue.
 */
export function buildManualTaskPayload(input: ManualTaskInput): GraphPayload {
  const task: GraphTask = {
    id: `${input.projectKey}-m${input.nonce}`,
    project: input.projectKey,
    pr: 999,
    owner: "you",
    kind: input.kind,
    effort_min: input.effortMin,
    deps: input.deps,
    title: input.title,
    short: input.title,
    sub: "imported — refine as you go",
    frees: "",
    in_progress: false,
    learn: placeholderLearn("manual entry"),
  };
  return { version: 1, projects: [], concepts: [INTAKE_CONCEPT], tasks: [task], seed_learned: [] };
}

// -- JSON-import detection ----------------------------------------------------

export interface ParsedGraphDrop {
  /** The dropped file's verbatim text — imported as-is, never rebuilt. */
  raw: string;
  taskCount: number;
  /** First project key in the payload (the lane to select), if any. */
  firstProjectKey: string | null;
}

/**
 * Recognize a dropped `.json` file that already IS an import-graph payload
 * (has `version` + a `tasks` array). Such drops skip the stub flow and
 * import verbatim. Returns null for anything else — including JSON that
 * isn't a graph, which falls through to the normal stub flow.
 */
export function parseGraphDrop(name: string, text: string): ParsedGraphDrop | null {
  if (!/\.json$/i.test(name)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.version !== "number" || !Array.isArray(record.tasks)) return null;
  let firstProjectKey: string | null = null;
  if (Array.isArray(record.projects)) {
    const first: unknown = record.projects[0];
    if (typeof first === "object" && first !== null) {
      const key = (first as Record<string, unknown>).key;
      if (typeof key === "string") firstProjectKey = key;
    }
  }
  return { raw: text, taskCount: record.tasks.length, firstProjectKey };
}
