//! SQLite schema, versioned via `PRAGMA user_version` and applied on open.

use rusqlite::Connection;

use crate::error::Result;

/// Current schema version.
pub const SCHEMA_VERSION: i64 = 1;

const V1: &str = "
CREATE TABLE project (
    key       TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    full_name TEXT NOT NULL,
    custom    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task (
    id          TEXT PRIMARY KEY,
    project     TEXT NOT NULL REFERENCES project(key),
    pr          INTEGER NOT NULL,
    owner       TEXT NOT NULL,
    kind        TEXT NOT NULL,
    effort_min  INTEGER NOT NULL DEFAULT 0,
    title       TEXT NOT NULL,
    short       TEXT NOT NULL,
    sub         TEXT NOT NULL,
    frees       TEXT NOT NULL,
    in_progress INTEGER NOT NULL DEFAULT 0,
    done        INTEGER NOT NULL DEFAULT 0,
    done_at     INTEGER
);

CREATE TABLE task_dep (
    task_id    TEXT NOT NULL REFERENCES task(id),
    depends_on TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE learn_loop (
    task_id          TEXT PRIMARY KEY REFERENCES task(id),
    before           TEXT NOT NULL,
    capture_question TEXT NOT NULL,
    capture_choices  TEXT NOT NULL,
    correct_index    INTEGER NOT NULL,
    why              TEXT NOT NULL,
    concept_id       TEXT NOT NULL REFERENCES concept(id)
);

CREATE TABLE learn_step (
    task_id      TEXT NOT NULL REFERENCES task(id),
    idx          INTEGER NOT NULL,
    text         TEXT NOT NULL,
    cmd          TEXT,
    concept_label TEXT,
    concept_text TEXT,
    PRIMARY KEY (task_id, idx)
);

CREATE TABLE decision_option (
    task_id TEXT NOT NULL REFERENCES task(id),
    idx     INTEGER NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT NOT NULL,
    PRIMARY KEY (task_id, idx)
);

CREATE TABLE concept (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    resurface_hint   TEXT,
    recheck_question TEXT
);

CREATE TABLE capture_event (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    concept_id TEXT NOT NULL REFERENCES concept(id),
    task_id    TEXT,
    at         INTEGER NOT NULL,
    result     TEXT NOT NULL
);

CREATE INDEX idx_capture_event_concept ON capture_event(concept_id, at, id);

CREATE TABLE choice (
    task_id      TEXT PRIMARY KEY REFERENCES task(id),
    chosen_index INTEGER NOT NULL,
    at           INTEGER NOT NULL
);
";

/// Run all pending migrations on `conn`. Each migration commits atomically
/// with its `user_version` bump, so a failure mid-batch leaves the previous
/// version intact rather than a half-created schema at version 0.
pub fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(&format!(
            "BEGIN;{V1}PRAGMA user_version = {SCHEMA_VERSION};COMMIT;"
        ))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_from_empty() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        for table in [
            "project",
            "task",
            "task_dep",
            "learn_loop",
            "learn_step",
            "decision_option",
            "concept",
            "capture_event",
            "choice",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table {table}");
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
    }
}
