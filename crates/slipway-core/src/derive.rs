//! Pure derivation logic: readiness, queues, streaks, resurface schedule,
//! and the "next" display strings the ledger shows.

use std::collections::{HashMap, HashSet};

use crate::model::{CaptureResult, Owner, Task};

/// Seconds in a day.
pub const DAY_SECS: i64 = 86_400;

/// A task is ready when it is not done and every dependency is done.
pub fn is_ready(task: &Task, deps: &HashMap<String, Vec<String>>, done: &HashSet<&str>) -> bool {
    !task.done
        && deps
            .get(&task.id)
            .is_none_or(|d| d.iter().all(|dep| done.contains(dep.as_str())))
}

/// Set of done task ids.
pub fn done_ids(tasks: &[Task]) -> HashSet<&str> {
    tasks
        .iter()
        .filter(|t| t.done)
        .map(|t| t.id.as_str())
        .collect()
}

/// Per-project queue: ready, owned by you, carrying a learn-loop —
/// ordered in-progress first, then by `pr`.
pub fn project_queue<'a>(
    project: &str,
    tasks: &'a [Task],
    deps: &HashMap<String, Vec<String>>,
    has_loop: &HashSet<String>,
) -> Vec<&'a Task> {
    let done = done_ids(tasks);
    let mut queue: Vec<&Task> = tasks
        .iter()
        .filter(|t| {
            t.project == project
                && t.owner == Owner::You
                && has_loop.contains(&t.id)
                && is_ready(t, deps, &done)
        })
        .collect();
    queue.sort_by(|a, b| b.in_progress.cmp(&a.in_progress).then(a.pr.cmp(&b.pr)));
    queue
}

/// Chronological summary of a concept's capture/recheck events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConceptState {
    /// Result of the latest event.
    pub latest: CaptureResult,
    /// Trailing consecutive `correct` count (a miss or hollow resets to 0).
    pub streak: u32,
    /// Unix seconds of the latest event.
    pub last_at: i64,
}

/// Summarize events (already in chronological order). `None` when empty.
pub fn concept_state(events: &[(i64, CaptureResult)]) -> Option<ConceptState> {
    let &(last_at, latest) = events.last()?;
    let streak = events
        .iter()
        .rev()
        .take_while(|(_, r)| *r == CaptureResult::Correct)
        .count() as u32;
    Some(ConceptState {
        latest,
        streak,
        last_at,
    })
}

/// Resurface interval in days after a run of `streak` corrects:
/// 4d × 2^(streak−1), capped at 30d.
pub fn correct_interval_days(streak: u32) -> i64 {
    match streak {
        0 | 1 => 4,
        2 => 8,
        3 => 16,
        _ => 30,
    }
}

/// How a concept's resurface hint relates to the graph right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HintStatus<'a> {
    /// No hint on the concept.
    None,
    /// A display-only hint like `~4d` or `30d` — the computed interval governs.
    Pure(&'a str),
    /// A hint that rides along with a task, like `with ds5` or `at ds7`.
    TaskRef {
        /// The full hint text.
        hint: &'a str,
        /// True while the referenced task is still open.
        open: bool,
    },
}

/// Extract the task id from a task-riding hint (`with ds5`, `at ds7`).
pub fn hint_task_ref(hint: &str) -> Option<&str> {
    let mut words = hint.split_whitespace();
    let lead = words.next()?;
    let id = words.next()?;
    if words.next().is_some() || !matches!(lead, "with" | "at") {
        return None;
    }
    let looks_like_task_id = id.starts_with(|c: char| c.is_ascii_lowercase())
        && id.contains(|c: char| c.is_ascii_digit())
        && id.chars().all(|c| c.is_ascii_alphanumeric());
    looks_like_task_id.then_some(id)
}

/// Classify a concept's hint given a predicate telling whether a task id is open.
pub fn hint_status<'a>(
    hint: Option<&'a str>,
    is_task_open: impl Fn(&str) -> bool,
) -> HintStatus<'a> {
    match hint {
        None => HintStatus::None,
        Some(h) => match hint_task_ref(h) {
            Some(task_id) => HintStatus::TaskRef {
                hint: h,
                open: is_task_open(task_id),
            },
            None => HintStatus::Pure(h),
        },
    }
}

/// The "next" display string for the ledger, matching the design prototype.
///
/// `latest_is_capture` is true when the latest event came from completing a
/// task (as opposed to answering a recheck). The prototype shows the author's
/// resurface hint right after a capture, but once the scheduler owns the
/// concept — i.e. after any recheck answer — it always shows the computed
/// interval (design script, `pickQuiz`). Task-riding hints keep showing while
/// their task is open, since they also govern the schedule.
pub fn next_display(state: ConceptState, hint: HintStatus<'_>, latest_is_capture: bool) -> String {
    match state.latest {
        CaptureResult::Hollow => "skipped — ask anytime".to_string(),
        CaptureResult::Miss => "~1d — missed".to_string(),
        CaptureResult::Correct => match hint {
            HintStatus::TaskRef { hint, open: true } => hint.to_string(),
            HintStatus::Pure(hint) if latest_is_capture => hint.to_string(),
            _ => format!("{}d", correct_interval_days(state.streak)),
        },
    }
}

/// Detect a dependency cycle. Returns the ids stuck in a cycle (sorted for
/// stable error messages), or `None` when the graph is acyclic.
pub fn find_cycle(deps: &HashMap<String, Vec<String>>) -> Option<Vec<String>> {
    // Kahn's algorithm over the dependency edges: repeatedly remove nodes
    // with no unresolved dependencies; whatever remains is cyclic.
    let mut pending: HashMap<&str, HashSet<&str>> = deps
        .iter()
        .map(|(id, ds)| (id.as_str(), ds.iter().map(String::as_str).collect()))
        .collect();
    loop {
        let resolved: Vec<&str> = pending
            .iter()
            .filter(|(_, ds)| ds.iter().all(|d| !pending.contains_key(*d)))
            .map(|(id, _)| *id)
            .collect();
        if resolved.is_empty() {
            break;
        }
        for id in resolved {
            pending.remove(id);
        }
    }
    if pending.is_empty() {
        return None;
    }
    let mut stuck: Vec<String> = pending.keys().map(|id| id.to_string()).collect();
    stuck.sort();
    Some(stuck)
}

/// Unix seconds at which the concept becomes due for a recheck.
/// `None` when it rides along with a still-open task instead of the clock.
pub fn due_at(state: ConceptState, hint: HintStatus<'_>) -> Option<i64> {
    match state.latest {
        CaptureResult::Hollow => Some(state.last_at),
        CaptureResult::Miss => Some(state.last_at + DAY_SECS),
        CaptureResult::Correct => match hint {
            HintStatus::TaskRef { open: true, .. } => None,
            _ => Some(state.last_at + correct_interval_days(state.streak) * DAY_SECS),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use CaptureResult::{Correct, Hollow, Miss};

    fn state(events: &[(i64, CaptureResult)]) -> ConceptState {
        concept_state(events).unwrap()
    }

    #[test]
    fn streak_counts_trailing_corrects() {
        assert_eq!(state(&[(1, Correct), (2, Correct)]).streak, 2);
        assert_eq!(state(&[(1, Correct), (2, Miss)]).streak, 0);
        assert_eq!(state(&[(1, Miss), (2, Correct), (3, Correct)]).streak, 2);
        assert_eq!(state(&[(1, Correct), (2, Hollow)]).streak, 0);
        assert!(concept_state(&[]).is_none());
    }

    #[test]
    fn interval_sequence_doubles_and_caps() {
        assert_eq!(correct_interval_days(1), 4);
        assert_eq!(correct_interval_days(2), 8);
        assert_eq!(correct_interval_days(3), 16);
        assert_eq!(correct_interval_days(4), 30);
        assert_eq!(correct_interval_days(9), 30);
    }

    #[test]
    fn miss_schedules_one_day_out() {
        let s = state(&[(100, Correct), (200, Miss)]);
        assert_eq!(due_at(s, HintStatus::None), Some(200 + DAY_SECS));
        assert_eq!(next_display(s, HintStatus::None, true), "~1d — missed");
    }

    #[test]
    fn hollow_is_due_immediately() {
        let s = state(&[(500, Hollow)]);
        assert_eq!(due_at(s, HintStatus::None), Some(500));
        assert_eq!(
            next_display(s, HintStatus::None, true),
            "skipped — ask anytime"
        );
    }

    #[test]
    fn correct_uses_computed_interval_without_hint() {
        let s = state(&[(0, Correct), (10, Correct)]);
        assert_eq!(next_display(s, HintStatus::None, true), "8d");
        assert_eq!(due_at(s, HintStatus::None), Some(10 + 8 * DAY_SECS));
    }

    #[test]
    fn task_ref_hint_rides_open_task_and_falls_back_when_done() {
        let s = state(&[(10, Correct)]);
        let open = HintStatus::TaskRef {
            hint: "with ds5",
            open: true,
        };
        assert_eq!(next_display(s, open, true), "with ds5");
        // Task-riding hints govern the schedule too, so they keep showing
        // even after a recheck answer.
        assert_eq!(next_display(s, open, false), "with ds5");
        assert_eq!(due_at(s, open), None);

        let closed = HintStatus::TaskRef {
            hint: "with ds5",
            open: false,
        };
        assert_eq!(next_display(s, closed, true), "4d");
        assert_eq!(due_at(s, closed), Some(10 + 4 * DAY_SECS));
    }

    #[test]
    fn pure_hint_shows_after_capture_only() {
        let s = state(&[(10, Correct)]);
        let hint = HintStatus::Pure("~4d");
        // Right after completing the task, the author's hint shows.
        assert_eq!(next_display(s, hint, true), "~4d");
        // After a recheck answer, the computed interval takes over —
        // the display must agree with when the recheck actually fires.
        assert_eq!(next_display(s, hint, false), "4d");
        let s2 = state(&[(0, Correct), (10, Correct)]);
        assert_eq!(next_display(s2, hint, false), "8d");
        // The computed interval always governs the schedule.
        assert_eq!(due_at(s, hint), Some(10 + 4 * DAY_SECS));
    }

    #[test]
    fn cycle_detection() {
        let acyclic: HashMap<String, Vec<String>> = [
            ("b".to_string(), vec!["a".to_string()]),
            ("c".to_string(), vec!["a".to_string(), "b".to_string()]),
        ]
        .into();
        assert_eq!(find_cycle(&acyclic), None);

        let cyclic: HashMap<String, Vec<String>> = [
            ("a".to_string(), vec!["c".to_string()]),
            ("b".to_string(), vec!["a".to_string()]),
            ("c".to_string(), vec!["b".to_string()]),
            ("d".to_string(), vec!["a".to_string()]),
        ]
        .into();
        assert_eq!(
            find_cycle(&cyclic),
            Some(vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string()
            ])
        );
    }

    #[test]
    fn hollow_is_due_even_while_hint_task_is_open() {
        let s = state(&[(10, Hollow)]);
        let open = HintStatus::TaskRef {
            hint: "at ds7",
            open: true,
        };
        assert_eq!(due_at(s, open), Some(10));
    }

    #[test]
    fn hint_parsing() {
        assert_eq!(hint_task_ref("with ds5"), Some("ds5"));
        assert_eq!(hint_task_ref("at sw4"), Some("sw4"));
        assert_eq!(hint_task_ref("~4d"), None);
        assert_eq!(hint_task_ref("30d"), None);
        assert_eq!(hint_task_ref("with the flow"), None);
    }

    #[test]
    fn hint_status_classifies() {
        assert_eq!(hint_status(None, |_| true), HintStatus::None);
        assert_eq!(hint_status(Some("~4d"), |_| true), HintStatus::Pure("~4d"));
        assert_eq!(
            hint_status(Some("with lm3"), |id| id == "lm3"),
            HintStatus::TaskRef {
                hint: "with lm3",
                open: true
            }
        );
        assert_eq!(
            hint_status(Some("at ds7"), |_| false),
            HintStatus::TaskRef {
                hint: "at ds7",
                open: false
            }
        );
    }
}
