//! Map-overlay integration tests: the branch-aware linearization over the
//! real `seed/launch-graph.json` must reproduce the design's chains exactly.

use slipway_core::{CaptureResult, ChainView, MapView, Owner, Store};

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

fn ids(chain: &ChainView) -> Vec<&str> {
    chain.pills.iter().map(|p| p.task_id.as_str()).collect()
}

fn chain<'a>(map: &'a MapView, label: &str) -> &'a ChainView {
    map.chains
        .iter()
        .find(|c| c.label == label)
        .unwrap_or_else(|| panic!("no chain labelled {label:?}"))
}

#[test]
fn seed_derives_exactly_the_designs_four_chains() {
    let map = seeded_store().map().unwrap();
    let labels: Vec<&str> = map.chains.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(
        labels,
        [
            "DECISION STUDIO — PATH A",
            "DECISION STUDIO — PATH B · ◆ds9 joins at ds7",
            "LOOM",
            "SLIPWAY",
        ]
    );
    assert_eq!(
        ids(&map.chains[0]),
        ["ds2", "ds3", "ds4", "ds6", "ds8", "launch"]
    );
    assert_eq!(ids(&map.chains[1]), ["ds1", "ds5", "ds7", "ds8", "launch"]);
    assert_eq!(
        ids(&map.chains[2]),
        ["lm1", "lm5", "lm2", "lm3", "lm4", "launch"]
    );
    assert_eq!(ids(&map.chains[3]), ["sw1", "sw2", "sw3", "sw4", "v0.1"]);
}

#[test]
fn seed_pills_carry_state_the_frontend_styles_from() {
    let map = seeded_store().map().unwrap();
    let path_a = chain(&map, "DECISION STUDIO — PATH A");

    // ds2 has no deps: ready, yours, not done.
    let ds2 = &path_a.pills[0];
    assert_eq!(ds2.short, "Merge PR #2 — schema domain");
    assert!(ds2.ready && !ds2.done && !ds2.flag);
    assert_eq!(ds2.owner, Owner::You);

    // ds3 waits on ds2.
    assert!(!path_a.pills[1].ready);

    // ds8 belongs to atlas; the backend ships the full short — truncation is
    // the frontend's job.
    let ds8 = &path_a.pills[4];
    assert_eq!(ds8.owner, Owner::Atlas);
    assert_eq!(ds8.short, "Marketing copy — you skim");

    // Flag pills are semantic markers only.
    let flag = path_a.pills.last().unwrap();
    assert_eq!(flag.task_id, "launch");
    assert!(flag.flag && flag.short.is_empty() && !flag.done && !flag.ready);
    assert_eq!(flag.owner, Owner::You);
}

#[test]
fn completing_ds2_flips_its_pill_done_and_ds3_ready() {
    let mut store = seeded_store();
    store
        .complete_task("ds2", CaptureResult::Correct, None, NOW)
        .unwrap();
    let map = store.map().unwrap();
    let path_a = chain(&map, "DECISION STUDIO — PATH A");
    let ds2 = &path_a.pills[0];
    assert!(ds2.done && !ds2.ready);
    let ds3 = &path_a.pills[1];
    assert!(ds3.ready && !ds3.done);
}

#[test]
fn isolated_ds10_is_absent_from_the_map() {
    let map = seeded_store().map().unwrap();
    assert!(map
        .chains
        .iter()
        .flat_map(|c| c.pills.iter())
        .all(|p| p.task_id != "ds10"));
}

#[test]
fn a_custom_imported_project_chains_without_a_flag() {
    let mut store = seeded_store();
    let custom = r#"{"version":1,
        "projects":[{"key":"zz","name":"SIDE QUEST","full_name":"side-quest","custom":true}],
        "concepts":[],
        "tasks":[
            {"id":"zz1","project":"zz","pr":1,"owner":"you","kind":"action","effort_min":5,
             "deps":[],"title":"First","short":"first thing","sub":"","frees":"",
             "in_progress":false,"learn":null},
            {"id":"zz2","project":"zz","pr":2,"owner":"you","kind":"action","effort_min":5,
             "deps":["zz1"],"title":"Second","short":"second thing","sub":"","frees":"",
             "in_progress":false,"learn":null}
        ],
        "seed_learned":[]}"#;
    store.import_graph_json(custom, NOW).unwrap();

    let map = store.map().unwrap();
    // Appended after the three seed projects, in creation order.
    assert_eq!(map.chains.len(), 5);
    let quest = chain(&map, "SIDE QUEST");
    assert_eq!(ids(quest), ["zz1", "zz2"]);
    assert!(quest.pills.iter().all(|p| !p.flag));
}
