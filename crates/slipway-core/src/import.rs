//! Graph import — the JSON schema of `seed/launch-graph.json` and the
//! replace-or-insert logic that lands it in SQLite.

use serde::Deserialize;

use crate::derive::DAY_SECS;
use crate::model::{CaptureResult, Owner, RecheckQuestion, TaskKind};

/// How far in the past the last synthetic seed event lands, so seeded
/// concepts (streak 4 → 30d interval) are due on first run.
pub const SEED_BACKDATE_SECS: i64 = 31 * DAY_SECS;

/// Top-level import payload.
#[derive(Debug, Deserialize)]
pub struct GraphImport {
    /// Schema version of the payload.
    pub version: i64,
    /// Project lanes.
    pub projects: Vec<ProjectImport>,
    /// Concepts referenced by learn-loops.
    pub concepts: Vec<ConceptImport>,
    /// Tasks with optional learn-loops.
    pub tasks: Vec<TaskImport>,
    /// Pre-seeded learned concepts (synthetic backdated history).
    #[serde(default)]
    pub seed_learned: Vec<SeedLearnedImport>,
}

impl GraphImport {
    /// Parse a graph payload from JSON.
    pub fn from_json(json: &str) -> crate::error::Result<Self> {
        Ok(serde_json::from_str(json)?)
    }
}

/// A project lane in the payload.
#[derive(Debug, Deserialize)]
pub struct ProjectImport {
    /// Short key, e.g. `ds`.
    pub key: String,
    /// Display name.
    pub name: String,
    /// Slug.
    pub full_name: String,
    /// True for intake-created lanes.
    #[serde(default)]
    pub custom: bool,
}

/// A concept in the payload.
#[derive(Debug, Deserialize)]
pub struct ConceptImport {
    /// Concept id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Resurface hint, e.g. `with ds5`, `~4d`.
    #[serde(default)]
    pub resurface_hint: Option<String>,
}

/// A task in the payload.
#[derive(Debug, Deserialize)]
pub struct TaskImport {
    /// Task id.
    pub id: String,
    /// Owning project key.
    pub project: String,
    /// Priority order within the project.
    pub pr: i64,
    /// Who executes it.
    pub owner: Owner,
    /// Action, decision, or provide.
    pub kind: TaskKind,
    /// Estimated effort in minutes.
    #[serde(default)]
    pub effort_min: i64,
    /// Ids of tasks this one depends on.
    #[serde(default)]
    pub deps: Vec<String>,
    /// Full title.
    pub title: String,
    /// Card-width title.
    pub short: String,
    /// One-line subtitle.
    #[serde(default)]
    pub sub: String,
    /// What completing this frees.
    #[serde(default)]
    pub frees: String,
    /// True while this is the live session.
    #[serde(default)]
    pub in_progress: bool,
    /// The learn-loop, when the task carries one.
    pub learn: Option<LearnImport>,
}

/// A learn-loop in the payload.
#[derive(Debug, Deserialize)]
pub struct LearnImport {
    /// Framing paragraph.
    pub before: String,
    /// Ordered steps.
    #[serde(default)]
    pub steps: Vec<StepImport>,
    /// Options if the task is a decision.
    #[serde(default)]
    pub decision_options: Vec<DecisionOptionImport>,
    /// The capture question.
    pub capture: CaptureImport,
}

/// One step of a learn-loop.
#[derive(Debug, Deserialize)]
pub struct StepImport {
    /// Position.
    pub idx: i64,
    /// Step text.
    pub text: String,
    /// Copyable command.
    #[serde(default)]
    pub cmd: Option<String>,
    /// Inline concept label.
    #[serde(default)]
    pub concept_label: Option<String>,
    /// Inline concept body.
    #[serde(default)]
    pub concept_text: Option<String>,
}

/// One option of a decision task.
#[derive(Debug, Deserialize)]
pub struct DecisionOptionImport {
    /// Position.
    pub idx: i64,
    /// Option title.
    pub title: String,
    /// Option body.
    pub body: String,
}

/// The capture question of a learn-loop.
#[derive(Debug, Deserialize)]
pub struct CaptureImport {
    /// Concept the capture feeds.
    pub concept_id: String,
    /// Question text.
    pub question: String,
    /// Answer choices.
    pub choices: Vec<String>,
    /// Index of the right answer.
    pub correct_index: usize,
    /// Why the right answer is right.
    pub why: String,
}

/// A pre-seeded learned concept.
#[derive(Debug, Deserialize)]
pub struct SeedLearnedImport {
    /// Concept id.
    pub concept_id: String,
    /// Task the synthetic captures are attributed to.
    pub from_task: String,
    /// Number of synthetic `correct` events to create.
    pub streak: u32,
    /// When true, a trailing `hollow` event is appended.
    #[serde(default)]
    pub hollow: bool,
    /// Display hint from the design (informational; derivation recomputes it).
    #[serde(default)]
    pub next: Option<String>,
    /// Bespoke standalone recheck question, stored on the concept.
    #[serde(default)]
    pub question: Option<RecheckQuestion>,
}

impl SeedLearnedImport {
    /// Timestamps for the synthetic events: `streak` corrects spaced a day
    /// apart, the last one backdated [`SEED_BACKDATE_SECS`] before `now`,
    /// plus an optional trailing hollow a minute later.
    pub fn synthetic_events(&self, now: i64) -> Vec<(i64, CaptureResult)> {
        let last_at = now - SEED_BACKDATE_SECS;
        let mut events: Vec<(i64, CaptureResult)> = (0..self.streak)
            .map(|i| {
                let back = i64::from(self.streak - 1 - i) * DAY_SECS;
                (last_at - back, CaptureResult::Correct)
            })
            .collect();
        if self.hollow {
            events.push((last_at + 60, CaptureResult::Hollow));
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_events_space_a_day_apart_and_backdate_the_last() {
        let seed = SeedLearnedImport {
            concept_id: "ttl".into(),
            from_task: "ds3".into(),
            streak: 4,
            hollow: false,
            next: None,
            question: None,
        };
        let now = 100 * DAY_SECS;
        let events = seed.synthetic_events(now);
        assert_eq!(events.len(), 4);
        let last = events.last().unwrap().0;
        assert_eq!(last, now - SEED_BACKDATE_SECS);
        for pair in events.windows(2) {
            assert_eq!(pair[1].0 - pair[0].0, DAY_SECS);
        }
        assert!(events.iter().all(|(_, r)| *r == CaptureResult::Correct));
    }
}
