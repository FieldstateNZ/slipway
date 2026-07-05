//! The map overlay: each project's dependency graph linearized into labelled
//! pill rows ("chains"). On demand, never home.
//!
//! Chains are **derived** from the dependency graph by a branch-aware
//! linearization — the design prototype's hardcoded seed chains are the
//! expected *output* of this module over `seed/launch-graph.json`, never an
//! input.
//!
//! # Linearization
//!
//! Per project (creation order; custom/intake lanes included), over the
//! project's task subgraph (dependency edges restricted to tasks of the same
//! project — the seed has no cross-project deps):
//!
//! 1. Tasks with no deps and no dependents ("isolated", e.g. `ds10`) are
//!    omitted from the map entirely.
//! 2. Every terminal task (no dependents) is walked backward. When
//!    linearizing a node, its deps are classified:
//!    - A dep is a **bare root** when it has no deps of its own and its only
//!      dependent is the node being linearized. Everything else is a
//!      **chain dep** (it has deps, or other tasks also depend on it).
//!    - No deps → the node alone.
//!    - All deps bare roots → inline them in `pr` order, then the node
//!      (`lm2`'s deps `lm1` + `lm5` → `lm1 lm5 lm2`).
//!    - Otherwise the path forks once per chain dep — each fork is that
//!      dep's linearization plus the node, and the shared tail continues
//!      (`ds8`'s deps `ds6` + `ds7` → two paths, both ending `… ds8`).
//!      Each bare-root dep becomes a "◆{id} joins at {node}" annotation
//!      carried by every fork (`ds7`'s deps `ds5` + `ds9` → `… ds5 ds7`
//!      annotated "◆ds9 joins at ds7").
//! 3. A project's paths are ordered longest first (tie: smaller first-task
//!    `pr`; stable, so terminal `pr` order breaks full ties), and a flag
//!    pill is appended to each: "launch" — or "v0.1" for project key `sw` —
//!    while custom lanes carry no flag.
//! 4. A single path is labelled with the project name; multiple paths get
//!    "{NAME} — PATH A", "PATH B", …. Join annotations append to their
//!    path's label: "{NAME} — PATH B · ◆ds9 joins at ds7".
//!
//! Refinement over the issue's classification sketch: a **custom** lane
//! whose tasks carry no dependency edges at all (intake can produce a flat
//! list) shows all its tasks as one chain in `pr` order instead of omitting
//! every task as isolated — the prototype renders custom chains as "just
//! their tasks". Non-custom projects keep the strict isolation rule.
//!
//! Import already rejects cycles and graphs are modest, so the recursion
//! neither guards against cycles nor memoizes shared sub-paths.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::derive;
use crate::model::{Owner, Project, Task};

/// The map overlay payload.
#[derive(Debug, Clone, Serialize)]
pub struct MapView {
    /// All chains, grouped by project in creation order.
    pub chains: Vec<ChainView>,
}

/// One labelled pill row.
#[derive(Debug, Clone, Serialize)]
pub struct ChainView {
    /// e.g. `DECISION STUDIO — PATH B · ◆ds9 joins at ds7`.
    pub label: String,
    /// Pills in dependency order; non-custom lanes end with a flag pill.
    pub pills: Vec<PillView>,
}

/// One pill. Semantics only — label text, truncation, and colors are the
/// frontend's job.
#[derive(Debug, Clone, Serialize)]
pub struct PillView {
    /// Task id — or the flag text (`launch` / `v0.1`) when `flag` is true.
    pub task_id: String,
    /// Card-width title; empty on flag pills.
    pub short: String,
    /// True once completed (flag pills: false).
    pub done: bool,
    /// True when not done and every dep is done (flag pills: false).
    pub ready: bool,
    /// Who executes it (flag pills: [`Owner::You`]).
    pub owner: Owner,
    /// True for the trailing `⚑` flag pill.
    pub flag: bool,
}

/// Assemble the full map from projects (creation order), tasks, and the
/// dependency edges.
pub fn map_view(
    projects: &[Project],
    tasks: &[Task],
    deps: &HashMap<String, Vec<String>>,
) -> MapView {
    let done = derive::done_ids(tasks);
    let by_id: HashMap<&str, &Task> = tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut chains = Vec::new();
    for project in projects {
        let mut project_tasks: Vec<&Task> =
            tasks.iter().filter(|t| t.project == project.key).collect();
        project_tasks.sort_by_key(|t| t.pr);
        let graph = ProjectGraph::build(&project_tasks, deps);
        let paths = project_paths(&project_tasks, &graph, project.custom);
        let multi = paths.len() > 1;
        for (index, path) in paths.iter().enumerate() {
            let mut pills: Vec<PillView> = path
                .ids
                .iter()
                .map(|id| task_pill(by_id[id], deps, &done))
                .collect();
            if !project.custom {
                pills.push(flag_pill(&project.key));
            }
            chains.push(ChainView {
                label: chain_label(project, path, index, multi),
                pills,
            });
        }
    }
    MapView { chains }
}

/// One linearized path before labelling.
struct RawPath<'a> {
    /// Task ids in dependency order.
    ids: Vec<&'a str>,
    /// `(bare_root, joins_at)` annotations, deepest node's first.
    joins: Vec<(&'a str, &'a str)>,
}

/// A project's task subgraph: deps and dependents restricted to the project.
struct ProjectGraph<'a> {
    /// `pr` per task id.
    pr: HashMap<&'a str, i64>,
    /// Within-project deps per task, `pr`-sorted. Every project task has an entry.
    deps: HashMap<&'a str, Vec<&'a str>>,
    /// Within-project dependents per task.
    dependents: HashMap<&'a str, Vec<&'a str>>,
}

impl<'a> ProjectGraph<'a> {
    fn build(project_tasks: &[&'a Task], all_deps: &'a HashMap<String, Vec<String>>) -> Self {
        let pr: HashMap<&str, i64> = project_tasks
            .iter()
            .map(|t| (t.id.as_str(), t.pr))
            .collect();
        let mut deps: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
        for task in project_tasks {
            let mut ds: Vec<&str> = all_deps
                .get(&task.id)
                .map(|v| {
                    v.iter()
                        .map(String::as_str)
                        .filter(|d| pr.contains_key(d))
                        .collect()
                })
                .unwrap_or_default();
            ds.sort_by_key(|d| self_pr(&pr, d));
            for dep in &ds {
                dependents.entry(dep).or_default().push(task.id.as_str());
            }
            deps.insert(task.id.as_str(), ds);
        }
        ProjectGraph {
            pr,
            deps,
            dependents,
        }
    }

    fn dep_count(&self, id: &str) -> usize {
        self.deps.get(id).map_or(0, Vec::len)
    }

    fn is_terminal(&self, id: &str) -> bool {
        self.dependents.get(id).is_none_or(Vec::is_empty)
    }

    /// A dep with no deps of its own whose only dependent is `node`.
    fn is_bare_root(&self, dep: &str, node: &str) -> bool {
        self.dep_count(dep) == 0
            && self
                .dependents
                .get(dep)
                .is_some_and(|ds| ds.len() == 1 && ds[0] == node)
    }
}

fn self_pr(pr: &HashMap<&str, i64>, id: &str) -> i64 {
    *pr.get(id).expect("dep filtered to project tasks")
}

/// All linearized paths of a project, sorted for labelling.
fn project_paths<'a>(
    project_tasks: &[&'a Task],
    graph: &ProjectGraph<'a>,
    custom: bool,
) -> Vec<RawPath<'a>> {
    let has_edges = project_tasks.iter().any(|t| graph.dep_count(&t.id) > 0);
    if !has_edges {
        // Every task is isolated. Custom flat-list fallback (module docs);
        // non-custom projects vanish from the map.
        if custom && !project_tasks.is_empty() {
            return vec![RawPath {
                ids: project_tasks.iter().map(|t| t.id.as_str()).collect(),
                joins: Vec::new(),
            }];
        }
        return Vec::new();
    }
    let mut paths = Vec::new();
    for task in project_tasks {
        let id = task.id.as_str();
        let isolated = graph.dep_count(id) == 0 && graph.is_terminal(id);
        if graph.is_terminal(id) && !isolated {
            paths.extend(linearize(graph, id));
        }
    }
    // Longest first; ties by the first task's pr. The sort is stable, so
    // terminal pr order decides full ties.
    paths.sort_by(|a, b| {
        b.ids
            .len()
            .cmp(&a.ids.len())
            .then_with(|| self_pr(&graph.pr, a.ids[0]).cmp(&self_pr(&graph.pr, b.ids[0])))
    });
    paths
}

/// Walk backward from `node`: one path per branch, per the module docs.
fn linearize<'a>(graph: &ProjectGraph<'a>, node: &'a str) -> Vec<RawPath<'a>> {
    let deps = &graph.deps[node];
    if deps.is_empty() {
        return vec![RawPath {
            ids: vec![node],
            joins: Vec::new(),
        }];
    }
    let (bare, chain): (Vec<&str>, Vec<&str>) = deps
        .iter()
        .copied()
        .partition(|dep| graph.is_bare_root(dep, node));
    if chain.is_empty() {
        // All deps are bare roots: inline them (already pr-sorted), then the node.
        let mut ids = bare;
        ids.push(node);
        return vec![RawPath {
            ids,
            joins: Vec::new(),
        }];
    }
    // Fork once per chain dep; every bare root annotates every fork.
    let mut paths = Vec::new();
    for dep in chain {
        for mut path in linearize(graph, dep) {
            path.ids.push(node);
            path.joins.extend(bare.iter().map(|b| (*b, node)));
            paths.push(path);
        }
    }
    paths
}

fn chain_label(project: &Project, path: &RawPath<'_>, index: usize, multi: bool) -> String {
    let mut label = project.name.clone();
    if multi {
        label.push_str(" — PATH ");
        label.push_str(&path_letters(index));
    }
    for (bare, at) in &path.joins {
        label.push_str(&format!(" · ◆{bare} joins at {at}"));
    }
    label
}

/// `A`, `B`, … `Z`, `AA`, `AB`, … — graphs are modest; this only exists so
/// an absurd import can't panic the label.
fn path_letters(mut index: usize) -> String {
    let mut letters = Vec::new();
    loop {
        letters.push(char::from(b'A' + (index % 26) as u8));
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    letters.into_iter().rev().collect()
}

fn task_pill(
    task: &Task,
    all_deps: &HashMap<String, Vec<String>>,
    done: &HashSet<&str>,
) -> PillView {
    PillView {
        task_id: task.id.clone(),
        short: task.short.clone(),
        done: task.done,
        ready: derive::is_ready(task, all_deps, done),
        owner: task.owner,
        flag: false,
    }
}

fn flag_pill(project_key: &str) -> PillView {
    let text = if project_key == "sw" {
        "v0.1"
    } else {
        "launch"
    };
    PillView {
        task_id: text.to_string(),
        short: String::new(),
        done: false,
        ready: false,
        owner: Owner::You,
        flag: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TaskKind;

    fn task(project: &str, id: &str, pr: i64) -> Task {
        Task {
            id: id.into(),
            project: project.into(),
            pr,
            owner: Owner::You,
            kind: TaskKind::Action,
            effort_min: 0,
            title: format!("Title {id}"),
            short: format!("short {id}"),
            sub: String::new(),
            frees: String::new(),
            in_progress: false,
            done: false,
            done_at: None,
        }
    }

    fn project(key: &str, name: &str, custom: bool) -> Project {
        Project {
            key: key.into(),
            name: name.into(),
            full_name: name.to_lowercase(),
            custom,
        }
    }

    fn dep_map(pairs: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(id, ds)| (id.to_string(), ds.iter().map(|d| d.to_string()).collect()))
            .collect()
    }

    fn ids(chain: &ChainView) -> Vec<&str> {
        chain.pills.iter().map(|p| p.task_id.as_str()).collect()
    }

    #[test]
    fn straight_chain_gets_the_project_name_and_a_flag() {
        let projects = [project("p", "PROJ", false)];
        let tasks = [task("p", "p1", 1), task("p", "p2", 2), task("p", "p3", 3)];
        let deps = dep_map(&[("p2", &["p1"]), ("p3", &["p2"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(map.chains.len(), 1);
        assert_eq!(map.chains[0].label, "PROJ");
        assert_eq!(ids(&map.chains[0]), ["p1", "p2", "p3", "launch"]);
        let flag = map.chains[0].pills.last().unwrap();
        assert!(flag.flag);
        assert!(flag.short.is_empty());
        assert!(!flag.done && !flag.ready);
        assert_eq!(flag.owner, Owner::You);
    }

    #[test]
    fn all_bare_root_deps_inline_in_pr_order() {
        // The LOOM shape: p3 depends on two dedicated roots.
        let projects = [project("p", "PROJ", false)];
        let tasks = [task("p", "p1", 1), task("p", "p2", 2), task("p", "p3", 3)];
        let deps = dep_map(&[("p3", &["p2", "p1"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(map.chains.len(), 1);
        assert_eq!(ids(&map.chains[0]), ["p1", "p2", "p3", "launch"]);
    }

    #[test]
    fn bare_root_beside_a_chain_dep_becomes_a_join_annotation() {
        // The ds7 shape: c depends on a chain (a→b) plus a dedicated root j.
        let projects = [project("p", "PROJ", false)];
        let tasks = [
            task("p", "a", 1),
            task("p", "b", 2),
            task("p", "j", 3),
            task("p", "c", 4),
        ];
        let deps = dep_map(&[("b", &["a"]), ("c", &["b", "j"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(map.chains.len(), 1);
        assert_eq!(map.chains[0].label, "PROJ · ◆j joins at c");
        assert_eq!(ids(&map.chains[0]), ["a", "b", "c", "launch"]);
    }

    #[test]
    fn multiple_chain_deps_fork_longest_path_first() {
        // The ds8 shape: t joins a long chain and a short one.
        let projects = [project("p", "PROJ", false)];
        let tasks = [
            task("p", "a", 1),
            task("p", "b", 2),
            task("p", "c", 3),
            task("p", "x", 4),
            task("p", "y", 5),
            task("p", "t", 6),
        ];
        let deps = dep_map(&[
            ("b", &["a"]),
            ("c", &["b"]),
            ("y", &["x"]),
            ("t", &["c", "y"]),
        ]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(map.chains.len(), 2);
        assert_eq!(map.chains[0].label, "PROJ — PATH A");
        assert_eq!(ids(&map.chains[0]), ["a", "b", "c", "t", "launch"]);
        assert_eq!(map.chains[1].label, "PROJ — PATH B");
        assert_eq!(ids(&map.chains[1]), ["x", "y", "t", "launch"]);
    }

    #[test]
    fn equal_length_forks_tie_break_on_root_pr() {
        let projects = [project("p", "PROJ", false)];
        let tasks = [
            task("p", "r2", 1),
            task("p", "r1", 2),
            task("p", "m2", 3),
            task("p", "m1", 4),
            task("p", "t", 5),
        ];
        // Both forks have length 3; the fork rooted at r2 (pr 1) sorts first
        // even though t's dep list names m1's branch first.
        let deps = dep_map(&[("m1", &["r1"]), ("m2", &["r2"]), ("t", &["m1", "m2"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(ids(&map.chains[0]), ["r2", "m2", "t", "launch"]);
        assert_eq!(map.chains[0].label, "PROJ — PATH A");
        assert_eq!(ids(&map.chains[1]), ["r1", "m1", "t", "launch"]);
    }

    #[test]
    fn a_shared_root_is_a_chain_dep_not_an_inlined_bare_root() {
        // r feeds both a and b, so it cannot inline into either: each fork
        // walks through it.
        let projects = [project("p", "PROJ", false)];
        let tasks = [
            task("p", "r", 1),
            task("p", "a", 2),
            task("p", "b", 3),
            task("p", "t", 4),
        ];
        let deps = dep_map(&[("a", &["r"]), ("b", &["r"]), ("t", &["a", "b"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(map.chains.len(), 2);
        assert_eq!(ids(&map.chains[0]), ["r", "a", "t", "launch"]);
        assert_eq!(ids(&map.chains[1]), ["r", "b", "t", "launch"]);
    }

    #[test]
    fn isolated_tasks_are_omitted() {
        let projects = [project("p", "PROJ", false)];
        let tasks = [task("p", "p1", 1), task("p", "p2", 2), task("p", "solo", 3)];
        let deps = dep_map(&[("p2", &["p1"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(map.chains.len(), 1);
        assert_eq!(ids(&map.chains[0]), ["p1", "p2", "launch"]);
    }

    #[test]
    fn sw_project_flags_v0_1() {
        let projects = [project("sw", "SLIPWAY", false)];
        let tasks = [task("sw", "sw1", 1), task("sw", "sw2", 2)];
        let deps = dep_map(&[("sw2", &["sw1"])]);
        let map = map_view(&projects, &tasks, &deps);
        assert_eq!(ids(&map.chains[0]), ["sw1", "sw2", "v0.1"]);
    }

    #[test]
    fn custom_lane_has_no_flag_and_shows_a_dep_less_flat_list() {
        let projects = [project("zz", "SCRATCH", true)];
        // No dependency edges at all: the custom fallback shows the lane as
        // one chain in pr order instead of omitting every task as isolated.
        let tasks = [task("zz", "zz2", 2), task("zz", "zz1", 1)];
        let map = map_view(&projects, &tasks, &HashMap::new());
        assert_eq!(map.chains.len(), 1);
        assert_eq!(map.chains[0].label, "SCRATCH");
        assert_eq!(ids(&map.chains[0]), ["zz1", "zz2"]);

        // A dep-less non-custom project stays strict: all isolated, no chain.
        let seedish = [project("zz", "SCRATCH", false)];
        assert!(map_view(&seedish, &tasks, &HashMap::new())
            .chains
            .is_empty());
    }

    #[test]
    fn done_and_ready_reflect_task_state() {
        let projects = [project("p", "PROJ", false)];
        let mut tasks = [task("p", "p1", 1), task("p", "p2", 2), task("p", "p3", 3)];
        tasks[0].done = true;
        let deps = dep_map(&[("p2", &["p1"]), ("p3", &["p2"])]);
        let map = map_view(&projects, &tasks, &deps);
        let pills = &map.chains[0].pills;
        assert!(pills[0].done && !pills[0].ready);
        assert!(!pills[1].done && pills[1].ready);
        assert!(!pills[2].done && !pills[2].ready);
    }

    #[test]
    fn path_letters_extend_past_z() {
        assert_eq!(path_letters(0), "A");
        assert_eq!(path_letters(1), "B");
        assert_eq!(path_letters(25), "Z");
        assert_eq!(path_letters(26), "AA");
        assert_eq!(path_letters(27), "AB");
    }
}
