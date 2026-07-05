//! SQLite-backed store: reads assemble derived views, writes record
//! completions, decisions, and recheck answers.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{params, Connection, Row};

use crate::derive::{self, HintStatus};
use crate::error::{Error, Result};
use crate::import::GraphImport;
use crate::model::{
    BoardView, CaptureEvent, CaptureResult, CaptureView, CompleteResult, Concept,
    ConceptCaptureView, DecisionOptionView, DueRecheck, FocusCard, LaneView, LearnLoop, LedgerRow,
    Owner, Project, RecheckOutcome, RecheckQuestion, StepView, Task, TaskDetail, TaskKind,
};
use crate::schema;

/// The application store. Wraps a single SQLite connection; migrations run
/// on open.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (or create) the database at `path` and run migrations.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    /// Open an in-memory database (tests, scratch runs).
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        // Bundled libsqlite3 happens to default foreign_keys on; declare it
        // so a system SQLite build enforces the same constraints.
        conn.pragma_update(None, "foreign_keys", true)?;
        schema::migrate(&conn)?;
        Ok(Store { conn })
    }

    // -- import / reset ----------------------------------------------------

    /// Parse and import a graph JSON payload (same schema as
    /// `seed/launch-graph.json`). See [`Store::import_graph`].
    pub fn import_graph_json(&mut self, json: &str, now: i64) -> Result<()> {
        let graph = GraphImport::from_json(json)?;
        self.import_graph(&graph, now)
    }

    /// Replace-or-insert every entity in `graph`. Task done-state and
    /// existing capture history survive re-import; `seed_learned` entries
    /// only create their synthetic backdated events when the concept has no
    /// events yet.
    pub fn import_graph(&mut self, graph: &GraphImport, now: i64) -> Result<()> {
        if graph.version != 1 {
            return Err(Error::UnsupportedVersion(graph.version));
        }
        let tx = self.conn.transaction()?;
        for p in &graph.projects {
            tx.execute(
                "INSERT INTO project (key, name, full_name, custom) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(key) DO UPDATE SET
                     name = excluded.name,
                     full_name = excluded.full_name,
                     custom = excluded.custom",
                params![p.key, p.name, p.full_name, p.custom],
            )?;
        }
        for c in &graph.concepts {
            tx.execute(
                "INSERT INTO concept (id, name, resurface_hint) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                     name = excluded.name,
                     resurface_hint = excluded.resurface_hint",
                params![c.id, c.name, c.resurface_hint],
            )?;
        }
        for t in &graph.tasks {
            tx.execute(
                "INSERT INTO task (id, project, pr, owner, kind, effort_min, title, short,
                                   sub, frees, in_progress, done, done_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, NULL)
                 ON CONFLICT(id) DO UPDATE SET
                     project = excluded.project,
                     pr = excluded.pr,
                     owner = excluded.owner,
                     kind = excluded.kind,
                     effort_min = excluded.effort_min,
                     title = excluded.title,
                     short = excluded.short,
                     sub = excluded.sub,
                     frees = excluded.frees,
                     in_progress = CASE WHEN done = 1 THEN 0
                                        ELSE excluded.in_progress END",
                params![
                    t.id,
                    t.project,
                    t.pr,
                    t.owner.as_str(),
                    t.kind.as_str(),
                    t.effort_min,
                    t.title,
                    t.short,
                    t.sub,
                    t.frees,
                    t.in_progress,
                ],
            )?;
            for table in ["task_dep", "learn_step", "decision_option", "learn_loop"] {
                tx.execute(
                    &format!("DELETE FROM {table} WHERE task_id = ?1"),
                    params![t.id],
                )?;
            }
            for dep in &t.deps {
                tx.execute(
                    "INSERT INTO task_dep (task_id, depends_on) VALUES (?1, ?2)",
                    params![t.id, dep],
                )?;
            }
            if let Some(learn) = &t.learn {
                tx.execute(
                    "INSERT INTO learn_loop (task_id, before, capture_question, capture_choices,
                                             correct_index, why, concept_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        t.id,
                        learn.before,
                        learn.capture.question,
                        serde_json::to_string(&learn.capture.choices)?,
                        learn.capture.correct_index,
                        learn.capture.why,
                        learn.capture.concept_id,
                    ],
                )?;
                for step in &learn.steps {
                    tx.execute(
                        "INSERT INTO learn_step (task_id, idx, text, cmd, concept_label,
                                                 concept_text)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            t.id,
                            step.idx,
                            step.text,
                            step.cmd,
                            step.concept_label,
                            step.concept_text
                        ],
                    )?;
                }
                for opt in &learn.decision_options {
                    tx.execute(
                        "INSERT INTO decision_option (task_id, idx, title, body)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![t.id, opt.idx, opt.title, opt.body],
                    )?;
                }
            }
        }
        // Validate the merged graph before committing: every dependency must
        // resolve to a task, and the graph must stay acyclic — otherwise a
        // task is silently blocked forever with no diagnostic.
        {
            let mut stmt = tx.prepare(
                "SELECT DISTINCT depends_on FROM task_dep
                 WHERE depends_on NOT IN (SELECT id FROM task)
                 ORDER BY depends_on",
            )?;
            let missing = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            if !missing.is_empty() {
                return Err(Error::UnknownDependency(missing.join(", ")));
            }
        }
        if let Some(cycle) = derive::find_cycle(&load_deps(&tx)?) {
            return Err(Error::DependencyCycle(cycle.join(", ")));
        }
        for seed in &graph.seed_learned {
            if let Some(question) = &seed.question {
                tx.execute(
                    "UPDATE concept SET recheck_question = ?2 WHERE id = ?1",
                    params![seed.concept_id, serde_json::to_string(question)?],
                )?;
            }
            let existing: i64 = tx.query_row(
                "SELECT count(*) FROM capture_event WHERE concept_id = ?1",
                params![seed.concept_id],
                |r| r.get(0),
            )?;
            if existing == 0 {
                for (at, result) in seed.synthetic_events(now) {
                    tx.execute(
                        "INSERT INTO capture_event (concept_id, task_id, at, result)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![seed.concept_id, seed.from_task, at, result.as_str()],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Wipe every row (footer reset, tests, dev).
    pub fn reset_all(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM choice;
             DELETE FROM capture_event;
             DELETE FROM decision_option;
             DELETE FROM learn_step;
             DELETE FROM learn_loop;
             DELETE FROM task_dep;
             DELETE FROM task;
             DELETE FROM concept;
             DELETE FROM project;",
        )?;
        Ok(())
    }

    // -- writes -------------------------------------------------------------

    /// Mark a task done at `now`, record the decision choice if provided,
    /// and append a capture event for the loop's concept.
    ///
    /// Guards: the task must exist, not be done already (double keypress /
    /// IPC retry), be owned by you, and have every dependency done. Decision
    /// tasks require an in-range choice; non-decision tasks reject one.
    pub fn complete_task(
        &mut self,
        task_id: &str,
        outcome: CaptureResult,
        decision_choice: Option<usize>,
        now: i64,
    ) -> Result<CompleteResult> {
        let tx = self.conn.transaction()?;
        let row: Option<(String, String, bool)> = tx
            .query_row(
                "SELECT kind, owner, done FROM task WHERE id = ?1",
                params![task_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        let Some((kind, owner, done)) = row else {
            return Err(Error::TaskNotFound(task_id.to_string()));
        };
        if done {
            return Err(Error::TaskAlreadyDone(task_id.to_string()));
        }
        if Owner::parse(&owner)? != Owner::You {
            return Err(Error::NotYourTask(task_id.to_string()));
        }
        let blocked: i64 = tx.query_row(
            "SELECT count(*) FROM task_dep d
             LEFT JOIN task t ON t.id = d.depends_on
             WHERE d.task_id = ?1 AND (t.id IS NULL OR t.done = 0)",
            params![task_id],
            |r| r.get(0),
        )?;
        if blocked > 0 {
            return Err(Error::TaskNotReady(task_id.to_string()));
        }
        let kind = TaskKind::parse(&kind)?;
        if kind == TaskKind::Decision {
            let options: i64 = tx.query_row(
                "SELECT count(*) FROM decision_option WHERE task_id = ?1",
                params![task_id],
                |r| r.get(0),
            )?;
            match decision_choice {
                Some(chosen) if (chosen as i64) < options => {
                    tx.execute(
                        "INSERT INTO choice (task_id, chosen_index, at) VALUES (?1, ?2, ?3)
                         ON CONFLICT(task_id) DO UPDATE SET
                             chosen_index = excluded.chosen_index,
                             at = excluded.at",
                        params![task_id, chosen, now],
                    )?;
                }
                _ => return Err(Error::InvalidDecisionChoice(task_id.to_string())),
            }
        } else if decision_choice.is_some() {
            return Err(Error::InvalidDecisionChoice(format!(
                "{task_id} is not a decision task"
            )));
        }
        tx.execute(
            "UPDATE task SET done = 1, done_at = ?2, in_progress = 0 WHERE id = ?1",
            params![task_id, now],
        )?;
        let concept_id: Option<String> = tx
            .query_row(
                "SELECT concept_id FROM learn_loop WHERE task_id = ?1",
                params![task_id],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        if let Some(cid) = &concept_id {
            tx.execute(
                "INSERT INTO capture_event (concept_id, task_id, at, result)
                 VALUES (?1, ?2, ?3, ?4)",
                params![cid, task_id, now, outcome.as_str()],
            )?;
        }
        // Assemble the return view before committing, so an assembly failure
        // rolls the completion back instead of stranding the frontend with an
        // error for a task that IS done.
        let capture = match concept_id {
            None => None,
            Some(cid) => {
                let concept = load_concept(&tx, &cid)?;
                let events = events_for(&tx, &cid)?;
                let state = derive::concept_state(&event_pairs(&events))
                    .ok_or_else(|| Error::InvalidValue(format!("no events for {cid}")))?;
                let hint_open = open_task_ids(&tx)?;
                let hint = derive::hint_status(concept.resurface_hint.as_deref(), |id| {
                    hint_open.contains(id)
                });
                let next_display = derive::next_display(state, hint, latest_is_capture(&events));
                Some(ConceptCaptureView {
                    concept_id: cid,
                    name: concept.name,
                    streak: state.streak,
                    hollow: state.latest == CaptureResult::Hollow,
                    next_display,
                })
            }
        };
        tx.commit()?;
        Ok(CompleteResult {
            task_id: task_id.to_string(),
            capture,
        })
    }

    /// Grade a recheck answer at `now`: appends a correct/miss event and
    /// returns whether it was right plus the updated "next" display.
    pub fn answer_recheck(
        &self,
        concept_id: &str,
        choice_index: usize,
        now: i64,
    ) -> Result<RecheckOutcome> {
        let concept = load_concept(&self.conn, concept_id)?;
        let events = events_for(&self.conn, concept_id)?;
        let question = recheck_question_for(&self.conn, &concept, &events)?
            .ok_or_else(|| Error::NoRecheckQuestion(concept_id.to_string()))?;
        if choice_index >= question.choices.len() {
            return Err(Error::InvalidValue(format!(
                "recheck choice {choice_index} out of range for {concept_id}"
            )));
        }
        let correct = choice_index == question.correct_index;
        let result = if correct {
            CaptureResult::Correct
        } else {
            CaptureResult::Miss
        };
        self.conn.execute(
            "INSERT INTO capture_event (concept_id, task_id, at, result)
             VALUES (?1, NULL, ?2, ?3)",
            params![concept_id, now, result.as_str()],
        )?;
        let events = events_for(&self.conn, concept_id)?;
        let state = derive::concept_state(&event_pairs(&events))
            .ok_or_else(|| Error::InvalidValue(format!("no events for {concept_id}")))?;
        let hint = hint_status_for(&self.conn, &concept)?;
        Ok(RecheckOutcome {
            correct,
            streak: state.streak,
            next_display: derive::next_display(state, hint, latest_is_capture(&events)),
        })
    }

    // -- reads --------------------------------------------------------------

    /// Per-lane board data plus the app-level ready summary.
    pub fn board(&self) -> Result<BoardView> {
        let projects = self.load_projects()?;
        let tasks = self.load_tasks()?;
        let deps = load_deps(&self.conn)?;
        let has_loop = self.loop_task_ids()?;
        let done = derive::done_ids(&tasks);

        let ready_you: Vec<&Task> = tasks
            .iter()
            .filter(|t| {
                t.owner == Owner::You
                    && has_loop.contains(&t.id)
                    && derive::is_ready(t, &deps, &done)
            })
            .collect();
        let ready_count = ready_you.len();
        let ready_effort_min = ready_you.iter().map(|t| t.effort_min).sum();

        let lanes = projects
            .into_iter()
            .map(|p| {
                let queue: Vec<FocusCard> = derive::project_queue(&p.key, &tasks, &deps, &has_loop)
                    .iter()
                    .map(|t| FocusCard {
                        id: t.id.clone(),
                        kind: t.kind,
                        effort_min: t.effort_min,
                        in_progress: t.in_progress,
                        title: t.title.clone(),
                        short: t.short.clone(),
                        sub: t.sub.clone(),
                        frees: t.frees.clone(),
                    })
                    .collect();
                let focus = queue.first().cloned();
                let remaining_effort_min = tasks
                    .iter()
                    .filter(|t| {
                        t.project == p.key && t.owner == Owner::You && t.effort_min > 0 && !t.done
                    })
                    .map(|t| t.effort_min)
                    .sum();
                LaneView {
                    key: p.key,
                    name: p.name,
                    full_name: p.full_name,
                    custom: p.custom,
                    others_behind: queue.len().saturating_sub(1),
                    remaining_effort_min,
                    focus,
                    queue,
                }
            })
            .collect();

        Ok(BoardView {
            lanes,
            ready_count,
            ready_effort_min,
        })
    }

    /// Full drawer detail for a task. Errors when the task has no learn-loop
    /// (only you-owned, loop-bearing tasks open the drawer).
    pub fn task_detail(&self, task_id: &str) -> Result<TaskDetail> {
        let tasks = self.load_tasks()?;
        let task = tasks
            .iter()
            .find(|t| t.id == task_id)
            .ok_or_else(|| Error::TaskNotFound(task_id.to_string()))?;
        let project_full_name: String = self.conn.query_row(
            "SELECT full_name FROM project WHERE key = ?1",
            params![task.project],
            |r| r.get(0),
        )?;
        let lp = load_loop(&self.conn, task_id)?
            .ok_or_else(|| Error::NoLearnLoop(task_id.to_string()))?;

        let mut stmt = self.conn.prepare(
            "SELECT text, cmd, concept_label, concept_text
             FROM learn_step WHERE task_id = ?1 ORDER BY idx",
        )?;
        let steps = stmt
            .query_map(params![task_id], |r| {
                Ok(StepView {
                    text: r.get(0)?,
                    cmd: r.get(1)?,
                    concept_label: r.get(2)?,
                    concept_text: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut stmt = self
            .conn
            .prepare("SELECT title, body FROM decision_option WHERE task_id = ?1 ORDER BY idx")?;
        let decision_options = stmt
            .query_map(params![task_id], |r| {
                Ok(DecisionOptionView {
                    title: r.get(0)?,
                    body: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(TaskDetail {
            id: task.id.clone(),
            kind: task.kind,
            effort_min: task.effort_min,
            title: task.title.clone(),
            sub: task.sub.clone(),
            frees: task.frees.clone(),
            project_full_name,
            before: lp.before,
            steps,
            decision_options,
            capture: CaptureView {
                question: lp.capture_question,
                choices: lp.capture_choices,
                correct_index: lp.correct_index,
                why: lp.why,
            },
        })
    }

    /// Ledger rows in first-capture order.
    pub fn ledger(&self) -> Result<Vec<LedgerRow>> {
        let open = open_task_ids(&self.conn)?;
        let mut rows = Vec::new();
        for (concept, events) in self.captured_concepts()? {
            let state = derive::concept_state(&event_pairs(&events))
                .ok_or_else(|| Error::InvalidValue(format!("no events for {}", concept.id)))?;
            let hint =
                derive::hint_status(concept.resurface_hint.as_deref(), |id| open.contains(id));
            let from_task = events
                .iter()
                .find_map(|e| e.task_id.clone())
                .unwrap_or_default();
            let has_question = recheck_question_for(&self.conn, &concept, &events)?.is_some();
            rows.push(LedgerRow {
                concept_id: concept.id,
                name: concept.name,
                from_task,
                streak: state.streak,
                hollow: state.latest == CaptureResult::Hollow,
                next_display: derive::next_display(state, hint, latest_is_capture(&events)),
                has_question,
            });
        }
        Ok(rows)
    }

    /// The single most-overdue recheck at `now`, if any concept is due.
    pub fn due_recheck(&self, now: i64) -> Result<Option<DueRecheck>> {
        let open = open_task_ids(&self.conn)?;
        let mut best: Option<(i64, DueRecheck)> = None;
        for (concept, events) in self.captured_concepts()? {
            let Some(state) = derive::concept_state(&event_pairs(&events)) else {
                continue;
            };
            let hint =
                derive::hint_status(concept.resurface_hint.as_deref(), |id| open.contains(id));
            let Some(due_at) = derive::due_at(state, hint) else {
                continue;
            };
            if due_at > now {
                continue;
            }
            let Some(question) = recheck_question_for(&self.conn, &concept, &events)? else {
                continue;
            };
            if best.as_ref().is_none_or(|(at, _)| due_at < *at) {
                best = Some((
                    due_at,
                    DueRecheck {
                        concept_id: concept.id,
                        name: concept.name,
                        question: question.question,
                        choices: question.choices,
                        correct_index: question.correct_index,
                        why: question.why,
                    },
                ));
            }
        }
        Ok(best.map(|(_, r)| r))
    }

    /// Ids of tasks that are ready right now (not done, all deps done),
    /// regardless of owner or loop. Mostly for tests and diagnostics.
    pub fn ready_task_ids(&self) -> Result<HashSet<String>> {
        let tasks = self.load_tasks()?;
        let deps = load_deps(&self.conn)?;
        let done = derive::done_ids(&tasks);
        Ok(tasks
            .iter()
            .filter(|t| derive::is_ready(t, &deps, &done))
            .map(|t| t.id.clone())
            .collect())
    }

    /// The recorded decision for a task: `(chosen_index, at)`.
    pub fn decision_choice(&self, task_id: &str) -> Result<Option<(usize, i64)>> {
        let row = self
            .conn
            .query_row(
                "SELECT chosen_index, at FROM choice WHERE task_id = ?1",
                params![task_id],
                |r| Ok((r.get::<_, usize>(0)?, r.get::<_, i64>(1)?)),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        Ok(row)
    }

    // -- internal loaders ---------------------------------------------------

    fn load_projects(&self) -> Result<Vec<Project>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, name, full_name, custom FROM project ORDER BY rowid")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Project {
                    key: r.get(0)?,
                    name: r.get(1)?,
                    full_name: r.get(2)?,
                    custom: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn load_tasks(&self) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project, pr, owner, kind, effort_min, title, short, sub, frees,
                    in_progress, done, done_at
             FROM task ORDER BY project, pr",
        )?;
        let rows = stmt
            .query_map([], task_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter().map(TaskRow::into_task).collect()
    }

    fn loop_task_ids(&self) -> Result<HashSet<String>> {
        let mut stmt = self.conn.prepare("SELECT task_id FROM learn_loop")?;
        let ids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<HashSet<_>>>()?;
        Ok(ids)
    }

    /// Concepts with at least one event, in first-capture order, with their
    /// chronological events.
    fn captured_concepts(&self) -> Result<Vec<(Concept, Vec<CaptureEvent>)>> {
        let mut stmt = self.conn.prepare(
            "SELECT concept_id FROM capture_event GROUP BY concept_id ORDER BY min(at), min(id)",
        )?;
        let concept_ids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        concept_ids
            .into_iter()
            .map(|cid| {
                let concept = load_concept(&self.conn, &cid)?;
                let events = events_for(&self.conn, &cid)?;
                Ok((concept, events))
            })
            .collect()
    }
}

// -- connection-level helpers (usable inside a transaction) -----------------

fn load_deps(conn: &Connection) -> Result<HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare("SELECT task_id, depends_on FROM task_dep")?;
    let mut deps: HashMap<String, Vec<String>> = HashMap::new();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (task_id, dep) = row?;
        deps.entry(task_id).or_default().push(dep);
    }
    Ok(deps)
}

/// Ids of tasks that exist and are not done.
fn open_task_ids(conn: &Connection) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT id FROM task WHERE done = 0")?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    Ok(ids)
}

fn load_loop(conn: &Connection, task_id: &str) -> Result<Option<LearnLoop>> {
    let row = conn
        .query_row(
            "SELECT before, capture_question, capture_choices, correct_index, why, concept_id
             FROM learn_loop WHERE task_id = ?1",
            params![task_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, usize>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    match row {
        None => Ok(None),
        Some((before, question, choices_json, correct_index, why, concept_id)) => {
            Ok(Some(LearnLoop {
                task_id: task_id.to_string(),
                before,
                capture_question: question,
                capture_choices: serde_json::from_str(&choices_json)?,
                correct_index,
                why,
                concept_id,
            }))
        }
    }
}

fn load_concept(conn: &Connection, id: &str) -> Result<Concept> {
    let row = conn
        .query_row(
            "SELECT name, resurface_hint, recheck_question FROM concept WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    let Some((name, resurface_hint, question_json)) = row else {
        return Err(Error::ConceptNotFound(id.to_string()));
    };
    let recheck_question = match question_json {
        None => None,
        Some(json) => Some(serde_json::from_str::<RecheckQuestion>(&json)?),
    };
    Ok(Concept {
        id: id.to_string(),
        name,
        resurface_hint,
        recheck_question,
    })
}

fn events_for(conn: &Connection, concept_id: &str) -> Result<Vec<CaptureEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, concept_id, task_id, at, result
         FROM capture_event WHERE concept_id = ?1 ORDER BY at, id",
    )?;
    let rows = stmt
        .query_map(params![concept_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(id, concept_id, task_id, at, result)| {
            Ok(CaptureEvent {
                id,
                concept_id,
                task_id,
                at,
                result: CaptureResult::parse(&result)?,
            })
        })
        .collect()
}

/// A concept's recheck question: the seed-provided standalone question if
/// present, otherwise the learn-loop question of its latest capture task.
fn recheck_question_for(
    conn: &Connection,
    concept: &Concept,
    events: &[CaptureEvent],
) -> Result<Option<RecheckQuestion>> {
    if let Some(q) = &concept.recheck_question {
        return Ok(Some(q.clone()));
    }
    for event in events.iter().rev() {
        let Some(task_id) = &event.task_id else {
            continue;
        };
        if let Some(lp) = load_loop(conn, task_id)? {
            return Ok(Some(RecheckQuestion {
                question: lp.capture_question,
                choices: lp.capture_choices,
                correct_index: lp.correct_index,
                why: lp.why,
            }));
        }
    }
    Ok(None)
}

fn hint_status_for<'a>(conn: &Connection, concept: &'a Concept) -> Result<HintStatus<'a>> {
    let open = open_task_ids(conn)?;
    Ok(derive::hint_status(concept.resurface_hint.as_deref(), {
        move |id: &str| open.contains(id)
    }))
}

/// `(at, result)` pairs for [`derive::concept_state`].
fn event_pairs(events: &[CaptureEvent]) -> Vec<(i64, CaptureResult)> {
    events.iter().map(|e| (e.at, e.result)).collect()
}

/// True when the latest event came from completing a task (not a recheck).
fn latest_is_capture(events: &[CaptureEvent]) -> bool {
    events.last().is_some_and(|e| e.task_id.is_some())
}

/// Raw task columns before the owner/kind vocabularies are parsed.
struct TaskRow {
    id: String,
    project: String,
    pr: i64,
    owner: String,
    kind: String,
    effort_min: i64,
    title: String,
    short: String,
    sub: String,
    frees: String,
    in_progress: bool,
    done: bool,
    done_at: Option<i64>,
}

impl TaskRow {
    fn into_task(self) -> Result<Task> {
        Ok(Task {
            owner: Owner::parse(&self.owner)?,
            kind: TaskKind::parse(&self.kind)?,
            id: self.id,
            project: self.project,
            pr: self.pr,
            effort_min: self.effort_min,
            title: self.title,
            short: self.short,
            sub: self.sub,
            frees: self.frees,
            in_progress: self.in_progress,
            done: self.done,
            done_at: self.done_at,
        })
    }
}

fn task_from_row(r: &Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        id: r.get(0)?,
        project: r.get(1)?,
        pr: r.get(2)?,
        owner: r.get(3)?,
        kind: r.get(4)?,
        effort_min: r.get(5)?,
        title: r.get(6)?,
        short: r.get(7)?,
        sub: r.get(8)?,
        frees: r.get(9)?,
        in_progress: r.get(10)?,
        done: r.get(11)?,
        done_at: r.get(12)?,
    })
}
