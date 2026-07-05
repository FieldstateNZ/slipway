//! Error type shared by the store, import, and derivation layers.

/// Any failure raised by slipway-core.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Underlying SQLite failure.
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// JSON (de)serialization failure — import payloads or stored question blobs.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    /// A task id that does not exist in the store.
    #[error("task not found: {0}")]
    TaskNotFound(String),
    /// A concept id that does not exist in the store.
    #[error("concept not found: {0}")]
    ConceptNotFound(String),
    /// The task exists but carries no learn-loop (atlas/pipeline work).
    #[error("task has no learn-loop: {0}")]
    NoLearnLoop(String),
    /// The concept has neither a seeded recheck question nor a captured loop question.
    #[error("concept has no recheck question: {0}")]
    NoRecheckQuestion(String),
    /// A stored column held a value outside its expected vocabulary.
    #[error("invalid stored value: {0}")]
    InvalidValue(String),
    /// Completing a task that is already done (double keypress, IPC retry).
    #[error("task already done: {0}")]
    TaskAlreadyDone(String),
    /// Completing a task whose dependencies are not all done.
    #[error("task not ready: {0}")]
    TaskNotReady(String),
    /// Completing a task owned by atlas/pipeline.
    #[error("task is not yours to complete: {0}")]
    NotYourTask(String),
    /// A decision task completed without a choice, or with one out of range.
    #[error("decision task needs an in-range choice: {0}")]
    InvalidDecisionChoice(String),
    /// An imported graph references a dependency id that no task defines.
    #[error("unknown dependency in import: {0}")]
    UnknownDependency(String),
    /// An imported graph contains a dependency cycle.
    #[error("dependency cycle in import: {0}")]
    DependencyCycle(String),
    /// An imported graph declares a schema version this build cannot read.
    #[error("unsupported graph version: {0}")]
    UnsupportedVersion(i64),
}

/// Convenience alias used across the crate.
pub type Result<T> = std::result::Result<T, Error>;
