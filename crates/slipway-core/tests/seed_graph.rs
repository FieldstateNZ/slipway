//! Integration tests over the real `seed/launch-graph.json`.

use std::collections::HashSet;

use slipway_core::derive::DAY_SECS;
use slipway_core::{CaptureResult, LedgerRow, Store};

/// A fixed "now" so schedule assertions are deterministic.
const NOW: i64 = 1_750_000_000;

fn seed_json() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed/launch-graph.json");
    std::fs::read_to_string(path).expect("seed graph readable")
}

fn seeded_store() -> Store {
    let mut store = Store::open_in_memory().unwrap();
    store.import_graph_json(&seed_json(), NOW).unwrap();
    store
}

fn ledger_row(store: &Store, concept_id: &str) -> LedgerRow {
    store
        .ledger()
        .unwrap()
        .into_iter()
        .find(|r| r.concept_id == concept_id)
        .unwrap_or_else(|| panic!("no ledger row for {concept_id}"))
}

#[test]
fn seed_readiness_matches_the_design() {
    let store = seeded_store();
    let ready = store.ready_task_ids().unwrap();
    let expected: HashSet<String> = ["ds1", "ds2", "ds9", "ds10", "lm1", "lm5", "sw1"]
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(ready, expected);
}

#[test]
fn ds3_is_blocked_until_ds2_is_done() {
    let mut store = seeded_store();
    assert!(!store.ready_task_ids().unwrap().contains("ds3"));
    store
        .complete_task("ds2", CaptureResult::Correct, None, NOW)
        .unwrap();
    assert!(store.ready_task_ids().unwrap().contains("ds3"));
}

#[test]
fn lane_focus_and_titlebar_summary() {
    let store = seeded_store();
    let board = store.board().unwrap();
    assert_eq!(board.ready_count, 7);
    assert_eq!(board.ready_effort_min, 22);

    let keys: Vec<&str> = board.lanes.iter().map(|l| l.key.as_str()).collect();
    assert_eq!(keys, ["ds", "lm", "sw"]);

    let ds = &board.lanes[0];
    // No ds task is in progress, so pr order picks ds1.
    let ds_focus = ds.focus.as_ref().unwrap();
    assert_eq!(ds_focus.id, "ds1");
    assert!(!ds_focus.in_progress);
    assert_eq!(ds.others_behind, 3); // ds2, ds9, ds10 queue behind
    assert_eq!(ds.remaining_effort_min, 58);
    assert_eq!(ds.name, "DECISION STUDIO");
    assert_eq!(ds.full_name, "decision-studio");
    assert!(!ds.custom);

    // sw1 is in progress, so it leads its lane.
    let sw = &board.lanes[2];
    let sw_focus = sw.focus.as_ref().unwrap();
    assert_eq!(sw_focus.id, "sw1");
    assert!(sw_focus.in_progress);
}

#[test]
fn completing_the_focus_advances_the_lane() {
    let mut store = seeded_store();
    let result = store
        .complete_task("sw1", CaptureResult::Correct, None, NOW)
        .unwrap();
    let capture = result.capture.unwrap();
    assert_eq!(capture.concept_id, "thesis");
    assert_eq!(capture.name, "the slipway thesis");
    assert_eq!(capture.streak, 1);
    // The thesis hint "at sw4" rides along with the still-open sw4.
    assert_eq!(capture.next_display, "at sw4");

    let board = store.board().unwrap();
    // sw2 is atlas-owned, so nothing needs you in the sw lane now.
    assert!(board.lanes[2].focus.is_none());
}

#[test]
fn seeded_ttl_is_due_on_first_run_with_streak_4() {
    let store = seeded_store();
    let row = ledger_row(&store, "ttl");
    assert_eq!(row.name, "cache ttl + propagation");
    assert_eq!(row.from_task, "ds3");
    assert_eq!(row.streak, 4);
    assert!(!row.hollow);
    assert_eq!(row.next_display, "30d");
    assert!(row.has_question);

    let due = store
        .due_recheck(NOW)
        .unwrap()
        .expect("ttl due on first run");
    assert_eq!(due.concept_id, "ttl");
    assert_eq!(
        due.question,
        "You drop a TTL from 3600 to 300 right before a cutover. Why?"
    );
    assert_eq!(due.correct_index, 1);
    assert_eq!(due.choices.len(), 4);
}

#[test]
fn hint_override_while_referenced_task_is_open_then_fallback() {
    let mut store = seeded_store();
    store
        .complete_task("ds1", CaptureResult::Correct, None, NOW)
        .unwrap();
    // oidc's hint "with ds5" rides along while ds5 is open.
    assert_eq!(ledger_row(&store, "oidc").next_display, "with ds5");

    store
        .complete_task("ds5", CaptureResult::Correct, None, NOW)
        .unwrap();
    // ds5 is done: oidc falls back to the computed interval (streak 1 → 4d).
    assert_eq!(ledger_row(&store, "oidc").next_display, "4d");
    // ds5's own capture feeds provenance, which rides the still-open ds7.
    assert_eq!(ledger_row(&store, "provenance").next_display, "with ds7");
}

#[test]
fn hollow_capture_is_flagged_and_due_immediately() {
    let mut store = seeded_store();
    store
        .complete_task("ds10", CaptureResult::Hollow, Some(0), NOW)
        .unwrap();
    let row = ledger_row(&store, "guards");
    assert!(row.hollow);
    assert_eq!(row.streak, 0);
    assert_eq!(row.next_display, "skipped — ask anytime");

    // ttl (overdue by a day) outranks the just-hollowed guards…
    let due = store.due_recheck(NOW).unwrap().unwrap();
    assert_eq!(due.concept_id, "ttl");
    // …but once ttl is answered, the hollow concept is offered right away.
    store.answer_recheck("ttl", 1, NOW).unwrap();
    let due = store.due_recheck(NOW).unwrap().unwrap();
    assert_eq!(due.concept_id, "guards");
}

#[test]
fn miss_resurfaces_after_one_day() {
    let store = seeded_store();
    let outcome = store.answer_recheck("ttl", 0, NOW).unwrap();
    assert!(!outcome.correct);
    assert_eq!(outcome.streak, 0);
    assert_eq!(outcome.next_display, "~1d — missed");

    assert!(store.due_recheck(NOW).unwrap().is_none());
    let due = store.due_recheck(NOW + DAY_SECS).unwrap().unwrap();
    assert_eq!(due.concept_id, "ttl");
}

#[test]
fn answer_recheck_correct_bumps_streak() {
    let store = seeded_store();
    let outcome = store.answer_recheck("ttl", 1, NOW).unwrap();
    assert!(outcome.correct);
    assert_eq!(outcome.streak, 5);
    assert_eq!(outcome.next_display, "30d");
    // Storage is uncapped; the ledger reports the raw streak.
    assert_eq!(ledger_row(&store, "ttl").streak, 5);
    // Interval stays capped at 30d, so nothing is due now.
    assert!(store.due_recheck(NOW).unwrap().is_none());
    assert!(store.due_recheck(NOW + 30 * DAY_SECS).unwrap().is_some());
}

#[test]
fn decision_path_records_the_choice() {
    let mut store = seeded_store();
    assert_eq!(store.decision_choice("ds9").unwrap(), None);
    let result = store
        .complete_task("ds9", CaptureResult::Correct, Some(0), NOW)
        .unwrap();
    assert_eq!(store.decision_choice("ds9").unwrap(), Some((0, NOW)));
    let capture = result.capture.unwrap();
    assert_eq!(capture.concept_id, "breaking");
    // "at ds7" rides the still-open ds7.
    assert_eq!(capture.next_display, "at ds7");
}

#[test]
fn task_detail_carries_the_drawer_payload() {
    let store = seeded_store();
    let detail = store.task_detail("ds3").unwrap();
    assert_eq!(detail.project_full_name, "decision-studio");
    assert_eq!(detail.steps.len(), 3);
    assert_eq!(
        detail.steps[0].cmd.as_deref(),
        Some("schema.workspec.io  CNAME  fieldstatenz.github.io")
    );
    assert_eq!(
        detail.steps[1].concept_label.as_deref(),
        Some("what propagation actually is")
    );
    assert_eq!(detail.capture.correct_index, 1);
    assert_eq!(
        detail.capture.question,
        "Why a CNAME here — not an A record?"
    );
    assert!(detail.decision_options.is_empty());

    let decision = store.task_detail("ds9").unwrap();
    assert_eq!(decision.decision_options.len(), 2);
    assert_eq!(
        decision.decision_options[0].title,
        "Rename now → schema.workspec.io/v1alpha1"
    );

    // Atlas/pipeline tasks carry no loop and never open the drawer.
    assert!(store.task_detail("ds8").is_err());
}

#[test]
fn ledger_lists_concepts_in_first_capture_order() {
    let mut store = seeded_store();
    store
        .complete_task("ds2", CaptureResult::Correct, None, NOW)
        .unwrap();
    store
        .complete_task("ds1", CaptureResult::Correct, None, NOW + 1)
        .unwrap();
    let order: Vec<String> = store
        .ledger()
        .unwrap()
        .into_iter()
        .map(|r| r.concept_id)
        .collect();
    assert_eq!(order, ["ttl", "urls", "oidc"]);
}

#[test]
fn reimport_is_idempotent_enough() {
    let mut store = seeded_store();
    store
        .complete_task("ds1", CaptureResult::Correct, None, NOW)
        .unwrap();
    store.import_graph_json(&seed_json(), NOW + 100).unwrap();

    // Done state survives, seeded history is not duplicated.
    assert!(!store.ready_task_ids().unwrap().contains("ds1"));
    assert!(store.ready_task_ids().unwrap().contains("ds5"));
    let ttl = ledger_row(&store, "ttl");
    assert_eq!(ttl.streak, 4);
    let oidc = ledger_row(&store, "oidc");
    assert_eq!(oidc.streak, 1);
}

#[test]
fn reset_all_wipes_everything() {
    let mut store = seeded_store();
    store
        .complete_task("ds1", CaptureResult::Correct, None, NOW)
        .unwrap();
    store.reset_all().unwrap();
    let board = store.board().unwrap();
    assert!(board.lanes.is_empty());
    assert_eq!(board.ready_count, 0);
    assert!(store.ledger().unwrap().is_empty());
    assert!(store.due_recheck(NOW).unwrap().is_none());

    // A fresh import lands cleanly after a reset.
    store.import_graph_json(&seed_json(), NOW).unwrap();
    assert_eq!(store.board().unwrap().lanes.len(), 3);
}

#[test]
fn unknown_ids_error_cleanly() {
    let mut store = seeded_store();
    assert!(store
        .complete_task("nope", CaptureResult::Correct, None, NOW)
        .is_err());
    assert!(store.task_detail("nope").is_err());
    assert!(store.answer_recheck("nope", 0, NOW).is_err());
}

// -- review-hardening regressions (S1 adversarial review) --------------------

#[test]
fn complete_task_guards_reject_bad_calls() {
    let mut store = seeded_store();

    // Double-complete must not duplicate capture events or inflate streaks.
    store
        .complete_task("ds1", CaptureResult::Correct, None, NOW)
        .unwrap();
    let err = store
        .complete_task("ds1", CaptureResult::Correct, None, NOW)
        .unwrap_err();
    assert!(matches!(
        err,
        slipway_core::Error::TaskAlreadyDone(ref id) if id == "ds1"
    ));
    assert_eq!(ledger_row(&store, "oidc").streak, 1);

    // Atlas/pipeline tasks are not yours to complete.
    let err = store
        .complete_task("ds8", CaptureResult::Correct, None, NOW)
        .unwrap_err();
    assert!(matches!(err, slipway_core::Error::NotYourTask(_)));

    // Blocked tasks cannot be completed around the dependency gate.
    let err = store
        .complete_task("ds3", CaptureResult::Correct, None, NOW)
        .unwrap_err();
    assert!(matches!(err, slipway_core::Error::TaskNotReady(_)));

    // Decisions demand an in-range choice; non-decisions reject one.
    for bad_choice in [None, Some(2), Some(99)] {
        let err = store
            .complete_task("ds9", CaptureResult::Correct, bad_choice, NOW)
            .unwrap_err();
        assert!(matches!(err, slipway_core::Error::InvalidDecisionChoice(_)));
    }
    let err = store
        .complete_task("ds2", CaptureResult::Correct, Some(0), NOW)
        .unwrap_err();
    assert!(matches!(err, slipway_core::Error::InvalidDecisionChoice(_)));
    // ...and none of the rejects marked anything done.
    assert!(store.ready_task_ids().unwrap().contains("ds9"));
    assert!(store.ready_task_ids().unwrap().contains("ds2"));
}

#[test]
fn import_rejects_unknown_deps_cycles_and_versions() {
    let mut store = seeded_store();

    let unknown = r#"{"version":1,"projects":[],"concepts":[],"tasks":[
        {"id":"zz1","project":"ds","pr":99,"owner":"you","kind":"action","effort_min":1,
         "deps":["nope"],"title":"t","short":"t","sub":"","frees":"","in_progress":false,"learn":null}
    ],"seed_learned":[]}"#;
    let err = store.import_graph_json(unknown, NOW).unwrap_err();
    assert!(matches!(err, slipway_core::Error::UnknownDependency(ref d) if d == "nope"));
    // The failed import rolled back: zz1 must not exist.
    assert!(!store.ready_task_ids().unwrap().contains("zz1"));

    let cyclic = r#"{"version":1,"projects":[],"concepts":[],"tasks":[
        {"id":"zz1","project":"ds","pr":98,"owner":"you","kind":"action","effort_min":1,
         "deps":["zz2"],"title":"t","short":"t","sub":"","frees":"","in_progress":false,"learn":null},
        {"id":"zz2","project":"ds","pr":99,"owner":"you","kind":"action","effort_min":1,
         "deps":["zz1"],"title":"t","short":"t","sub":"","frees":"","in_progress":false,"learn":null}
    ],"seed_learned":[]}"#;
    let err = store.import_graph_json(cyclic, NOW).unwrap_err();
    assert!(matches!(err, slipway_core::Error::DependencyCycle(_)));

    let future = r#"{"version":99,"projects":[],"concepts":[],"tasks":[],"seed_learned":[]}"#;
    let err = store.import_graph_json(future, NOW).unwrap_err();
    assert!(matches!(err, slipway_core::Error::UnsupportedVersion(99)));
}

#[test]
fn pure_hint_yields_to_computed_interval_after_recheck() {
    let mut store = seeded_store();
    // guards has the pure hint "~4d": shown right after the capture…
    store
        .complete_task("ds10", CaptureResult::Correct, Some(0), NOW)
        .unwrap();
    assert_eq!(ledger_row(&store, "guards").next_display, "~4d");
    // …but a recheck answer hands display over to the computed schedule.
    store.answer_recheck("guards", 1, NOW + DAY_SECS).unwrap();
    assert_eq!(ledger_row(&store, "guards").next_display, "8d");
}

#[test]
fn recheck_rejects_out_of_range_choice() {
    let store = seeded_store();
    let err = store.answer_recheck("ttl", 9, NOW).unwrap_err();
    assert!(matches!(err, slipway_core::Error::InvalidValue(_)));
}

#[test]
fn reimport_never_resurrects_in_progress_on_done_tasks() {
    let mut store = seeded_store();
    store
        .complete_task("sw1", CaptureResult::Correct, None, NOW)
        .unwrap();
    store.import_graph_json(&seed_json(), NOW).unwrap();
    let board = store.board().unwrap();
    let sw = board.lanes.iter().find(|l| l.key == "sw").unwrap();
    // sw1 is done: no ready you-task remains in the lane at all.
    assert!(sw.focus.is_none());
}
