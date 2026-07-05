# Data model

Slipway is local-first: one SQLite file, `slipway.db`, in the platform app-data
directory (`~/.local/share/nz.fieldstate.slipway` on Linux,
`~/Library/Application Support/nz.fieldstate.slipway` on macOS,
`%APPDATA%\nz.fieldstate.slipway` on Windows). The Rust core that owns it lives
in [`crates/slipway-core`](../crates/slipway-core); the schema is
[`schema.rs`](../crates/slipway-core/src/schema.rs), the derivations
[`derive.rs`](../crates/slipway-core/src/derive.rs).

The design principle: **the database stores facts, never derived state**.
Readiness, queues, streaks, and the resurfacing schedule are all recomputed
from rows on every read.

## Tables (schema v1)

| Table             | What it holds                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`         | One lane on the board: `key` (e.g. `ds`), display `name`, `full_name` slug, `custom` flag for intake-created lanes.                                                                                                                                     |
| `task`            | A node in the dependency graph: `project`, `pr` (priority order), `owner` (`you`/`atlas`/`pipeline`), `kind` (`action`/`decision`/`provide`), `effort_min`, display copy (`title`, `short`, `sub`, `frees`), `in_progress`, `done`, `done_at`.          |
| `task_dep`        | Dependency edges: `task_id` depends on `depends_on`.                                                                                                                                                                                                    |
| `learn_loop`      | The learn-loop attached to a task: `before` framing, the capture question (`capture_question`, `capture_choices` as JSON, `correct_index`, `why`), and the `concept_id` the capture feeds.                                                              |
| `learn_step`      | Ordered steps of a loop: `text`, optional `cmd`, optional inline concept disclosure (`concept_label`, `concept_text`).                                                                                                                                  |
| `decision_option` | The options of a `decision` task.                                                                                                                                                                                                                       |
| `concept`         | A retained-capability unit: `name`, optional `resurface_hint`, optional bespoke `recheck_question` (JSON).                                                                                                                                              |
| `capture_event`   | Append-only history per concept: `concept_id`, nullable `task_id`, `at` (unix seconds), `result` (`correct`/`miss`/`hollow`). `task_id` set = the event came from completing a task (a **capture**); `task_id` NULL = it came from answering a recheck. |
| `choice`          | Which option a completed `decision` task picked.                                                                                                                                                                                                        |

## Derivations

All pure functions in `derive.rs`, unit-tested against the design prototype.

- **Ready** — a task is ready when it is not done and every row in `task_dep`
  points at a done task.
- **Lane queue** — per project: ready ∧ `owner = you` ∧ has a learn-loop,
  ordered `in_progress` first, then by `pr`. The board deals the head of the
  queue as the lane's one focus card; the rest is a whisper count.
- **Concept state** — fold a concept's `capture_event` rows chronologically:
  `latest` result, `streak` = trailing consecutive `correct` count (a miss or
  hollow resets it to 0), `last_at`.
- **Schedule** — when a concept resurfaces, derived from state + hint. The
  exact interval rules, hint semantics (`~4d` vs `with ds5`), and the
  capture-vs-recheck display rule live in
  [resurfacing-scheduler.md](resurfacing-scheduler.md).
- **Cycle detection** — imports reject graphs whose `deps` contain a cycle
  (Kahn's algorithm; the stuck ids are named in the error).

## Import semantics

`import_graph` (the JSON schema of
[`seed/launch-graph.json`](../seed/launch-graph.json), documented in the
[README](../README.md#json-import-schema)) is **replace-or-insert per entity,
inside one transaction**:

- Projects, concepts, tasks, and loop content upsert — re-importing a graph
  updates copy and structure in place.
- Task done-state (`done`, `done_at`) and all `capture_event` history
  **survive re-import**: an import never un-does work or forgets a streak.
- `seed_learned` entries write their synthetic backdated events **only when
  the concept has no events yet**, so re-importing the seed never duplicates
  history.
- The payload `version` must be `1`; anything else is rejected up front.

## Migrations (the update story)

The schema is versioned with SQLite's `PRAGMA user_version` and migrated in
`Store::open`, which every entry point (app start, tests) goes through:

- `SCHEMA_VERSION` is currently **1**.
- Each migration executes as a single batch: `BEGIN; <DDL>; PRAGMA
user_version = N; COMMIT;` — the version bump commits atomically with the
  DDL, so a failure mid-migration leaves the previous version intact instead
  of a half-created schema.
- `migrate` is idempotent and forward-only: opening a database that is already
  at the current version is a no-op; an app update that ships `SCHEMA_VERSION
= 2` will find `user_version = 1` on first launch and apply exactly the v2
  step. Downgrades are not supported.

No action is needed on update: the user's `slipway.db` is migrated in place
the first time the new binary opens it.
