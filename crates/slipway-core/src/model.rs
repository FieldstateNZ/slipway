//! Domain rows and the derived-view structs handed to the frontend.
//!
//! View structs carry semantic data only — whispers, button labels, and
//! toast copy are assembled by the frontend.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Who executes a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Owner {
    /// The human at the keyboard.
    You,
    /// The atlas agent.
    Atlas,
    /// The CI/automation pipeline.
    Pipeline,
}

impl Owner {
    /// Stable text form stored in SQLite.
    pub fn as_str(self) -> &'static str {
        match self {
            Owner::You => "you",
            Owner::Atlas => "atlas",
            Owner::Pipeline => "pipeline",
        }
    }

    /// Parse the stored text form.
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "you" => Ok(Owner::You),
            "atlas" => Ok(Owner::Atlas),
            "pipeline" => Ok(Owner::Pipeline),
            other => Err(Error::InvalidValue(format!("owner: {other}"))),
        }
    }
}

/// What shape of work a task is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    /// Do a thing.
    Action,
    /// Make a call between options.
    Decision,
    /// Hand something over (a key, a target, a word).
    Provide,
}

impl TaskKind {
    /// Stable text form stored in SQLite.
    pub fn as_str(self) -> &'static str {
        match self {
            TaskKind::Action => "action",
            TaskKind::Decision => "decision",
            TaskKind::Provide => "provide",
        }
    }

    /// Parse the stored text form.
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "action" => Ok(TaskKind::Action),
            "decision" => Ok(TaskKind::Decision),
            "provide" => Ok(TaskKind::Provide),
            other => Err(Error::InvalidValue(format!("kind: {other}"))),
        }
    }
}

/// Outcome of a capture question or recheck quiz.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureResult {
    /// Answered right.
    Correct,
    /// Answered wrong.
    Miss,
    /// Skipped — the task is done but the concept was left hollow.
    Hollow,
}

impl CaptureResult {
    /// Stable text form stored in SQLite.
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureResult::Correct => "correct",
            CaptureResult::Miss => "miss",
            CaptureResult::Hollow => "hollow",
        }
    }

    /// Parse the stored text form.
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "correct" => Ok(CaptureResult::Correct),
            "miss" => Ok(CaptureResult::Miss),
            "hollow" => Ok(CaptureResult::Hollow),
            other => Err(Error::InvalidValue(format!("result: {other}"))),
        }
    }
}

/// A project lane.
#[derive(Debug, Clone)]
pub struct Project {
    /// Short key, e.g. `ds`.
    pub key: String,
    /// Display name, e.g. `DECISION STUDIO`.
    pub name: String,
    /// Slug, e.g. `decision-studio`.
    pub full_name: String,
    /// True for lanes created by intake rather than the seed graph.
    pub custom: bool,
}

/// A task row.
#[derive(Debug, Clone)]
pub struct Task {
    /// Task id, e.g. `ds3`.
    pub id: String,
    /// Owning project key.
    pub project: String,
    /// Priority order within the project.
    pub pr: i64,
    /// Who executes it.
    pub owner: Owner,
    /// Action, decision, or provide.
    pub kind: TaskKind,
    /// Estimated effort in minutes (0 = ongoing / not yours to burn).
    pub effort_min: i64,
    /// Full title.
    pub title: String,
    /// Card-width title.
    pub short: String,
    /// One-line subtitle.
    pub sub: String,
    /// What completing this frees, e.g. `frees ds5 → release path`.
    pub frees: String,
    /// True while the task is the live session.
    pub in_progress: bool,
    /// True once completed.
    pub done: bool,
    /// Unix seconds when completed.
    pub done_at: Option<i64>,
}

/// A learn-loop attached to a task.
#[derive(Debug, Clone)]
pub struct LearnLoop {
    /// The task this loop belongs to.
    pub task_id: String,
    /// The framing paragraph shown before starting.
    pub before: String,
    /// The capture question asked at completion.
    pub capture_question: String,
    /// Answer choices.
    pub capture_choices: Vec<String>,
    /// Index of the right answer.
    pub correct_index: usize,
    /// Why the right answer is right.
    pub why: String,
    /// Concept the capture feeds.
    pub concept_id: String,
}

/// A concept in the learning ledger.
#[derive(Debug, Clone)]
pub struct Concept {
    /// Concept id, e.g. `ttl`.
    pub id: String,
    /// Display name, e.g. `cache ttl + propagation`.
    pub name: String,
    /// Resurface hint from the graph, e.g. `with ds5`, `~4d`, `30d`.
    pub resurface_hint: Option<String>,
    /// Seed-provided standalone recheck question (e.g. for `ttl`).
    /// Task-captured concepts use their learn-loop question instead.
    pub recheck_question: Option<RecheckQuestion>,
}

/// A standalone multiple-choice question used for rechecks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecheckQuestion {
    /// The question text.
    pub question: String,
    /// Answer choices.
    pub choices: Vec<String>,
    /// Index of the right answer.
    pub correct_index: usize,
    /// Why the right answer is right.
    pub why: String,
}

/// One capture or recheck outcome for a concept.
#[derive(Debug, Clone)]
pub struct CaptureEvent {
    /// Row id (insertion order tiebreaker).
    pub id: i64,
    /// Concept the event belongs to.
    pub concept_id: String,
    /// Task the capture came from; `None` for recheck-quiz events.
    pub task_id: Option<String>,
    /// Unix seconds.
    pub at: i64,
    /// Outcome.
    pub result: CaptureResult,
}

// ---------------------------------------------------------------------------
// Derived views returned over IPC.
// ---------------------------------------------------------------------------

/// Everything the board needs to paint the lanes and the titlebar summary.
#[derive(Debug, Clone, Serialize)]
pub struct BoardView {
    /// One entry per project, in creation order.
    pub lanes: Vec<LaneView>,
    /// App-wide count of ready, you-owned, loop-bearing tasks.
    pub ready_count: usize,
    /// Total effort minutes across those ready tasks.
    pub ready_effort_min: i64,
}

/// One project lane.
#[derive(Debug, Clone, Serialize)]
pub struct LaneView {
    /// Project key, e.g. `ds`.
    pub key: String,
    /// Display name, e.g. `DECISION STUDIO`.
    pub name: String,
    /// Slug, e.g. `decision-studio`.
    pub full_name: String,
    /// True for intake-created lanes.
    pub custom: bool,
    /// The single card dealt to this lane by default — always `queue.first()`.
    pub focus: Option<FocusCard>,
    /// The full ready-you queue (in_progress first, then `pr` order). The
    /// frontend's Tab-deal cycles this client-side, per the prototype.
    pub queue: Vec<FocusCard>,
    /// How many further ready tasks queue behind the focus.
    pub others_behind: usize,
    /// Remaining you-owned effort minutes in this project (not-done, effort > 0).
    pub remaining_effort_min: i64,
}

/// The focus card dealt to a lane.
#[derive(Debug, Clone, Serialize)]
pub struct FocusCard {
    /// Task id.
    pub id: String,
    /// Action, decision, or provide.
    pub kind: TaskKind,
    /// Estimated effort in minutes.
    pub effort_min: i64,
    /// True while this is the live session.
    pub in_progress: bool,
    /// Full title.
    pub title: String,
    /// Card-width title.
    pub short: String,
    /// One-line subtitle.
    pub sub: String,
    /// What completing this frees.
    pub frees: String,
}

/// One step inside the task drawer.
#[derive(Debug, Clone, Serialize)]
pub struct StepView {
    /// Step text.
    pub text: String,
    /// Copyable command, if any.
    pub cmd: Option<String>,
    /// Inline concept label, if the step teaches something.
    pub concept_label: Option<String>,
    /// Inline concept body.
    pub concept_text: Option<String>,
}

/// One option of a decision task.
#[derive(Debug, Clone, Serialize)]
pub struct DecisionOptionView {
    /// Option title.
    pub title: String,
    /// Option body.
    pub body: String,
}

/// The capture question shown at completion. `correct_index` ships to the
/// frontend on purpose: this is a local-first app and the drawer grades locally.
#[derive(Debug, Clone, Serialize)]
pub struct CaptureView {
    /// Question text.
    pub question: String,
    /// Answer choices.
    pub choices: Vec<String>,
    /// Index of the right answer.
    pub correct_index: usize,
    /// Why the right answer is right.
    pub why: String,
}

/// Full detail for the task drawer.
#[derive(Debug, Clone, Serialize)]
pub struct TaskDetail {
    /// Task id.
    pub id: String,
    /// Action, decision, or provide.
    pub kind: TaskKind,
    /// Estimated effort in minutes.
    pub effort_min: i64,
    /// Full title.
    pub title: String,
    /// One-line subtitle.
    pub sub: String,
    /// What completing this frees.
    pub frees: String,
    /// Owning project slug, e.g. `decision-studio`.
    pub project_full_name: String,
    /// Framing paragraph.
    pub before: String,
    /// Ordered steps.
    pub steps: Vec<StepView>,
    /// Options if this is a decision task; empty otherwise.
    pub decision_options: Vec<DecisionOptionView>,
    /// The capture question.
    pub capture: CaptureView,
}

/// One row of the learning ledger, in first-capture order.
#[derive(Debug, Clone, Serialize)]
pub struct LedgerRow {
    /// Concept id.
    pub concept_id: String,
    /// Concept display name.
    pub name: String,
    /// Task the concept was first captured from.
    pub from_task: String,
    /// Trailing consecutive correct count (uncapped; UI caps display at 4).
    pub streak: u32,
    /// True when the latest event is `hollow`.
    pub hollow: bool,
    /// Resurface display string, e.g. `with ds5`, `30d`, `~1d — missed`.
    pub next_display: String,
    /// True when a recheck question exists for this concept.
    pub has_question: bool,
}

/// The single most-overdue recheck on offer, if any.
#[derive(Debug, Clone, Serialize)]
pub struct DueRecheck {
    /// Concept id.
    pub concept_id: String,
    /// Concept display name.
    pub name: String,
    /// Question text.
    pub question: String,
    /// Answer choices.
    pub choices: Vec<String>,
    /// Index of the right answer (local-first grading).
    pub correct_index: usize,
    /// Why the right answer is right.
    pub why: String,
}

/// Result of answering a recheck.
#[derive(Debug, Clone, Serialize)]
pub struct RecheckOutcome {
    /// Whether the picked choice was right.
    pub correct: bool,
    /// Updated streak.
    pub streak: u32,
    /// Updated resurface display string.
    pub next_display: String,
}

/// Ledger delta produced by completing a task's capture question.
#[derive(Debug, Clone, Serialize)]
pub struct ConceptCaptureView {
    /// Concept id.
    pub concept_id: String,
    /// Concept display name.
    pub name: String,
    /// Updated streak.
    pub streak: u32,
    /// True when the concept was left hollow.
    pub hollow: bool,
    /// Updated resurface display string.
    pub next_display: String,
}

/// Result of completing a task.
#[derive(Debug, Clone, Serialize)]
pub struct CompleteResult {
    /// The completed task id.
    pub task_id: String,
    /// The ledger delta, when the task carried a learn-loop.
    pub capture: Option<ConceptCaptureView>,
}
