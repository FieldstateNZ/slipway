//! Slipway domain model, SQLite persistence, and derivation engine.
//!
//! SQLite is the source of truth; the frontend receives derived state
//! through typed Tauri commands defined in the `slipway` app crate.
//! Presentation strings (whispers, button labels, toasts) live in the
//! frontend — this crate returns semantic data only, with the single
//! exception of the ledger's "next" display strings, which the design
//! specifies character-for-character.

pub mod derive;
pub mod error;
pub mod import;
pub mod map;
pub mod model;
pub mod schema;
pub mod store;

pub use error::{Error, Result};
pub use import::GraphImport;
pub use map::{ChainView, MapView, PillView};
pub use model::{
    BoardView, CaptureResult, CaptureView, CompleteResult, ConceptCaptureView, DecisionOptionView,
    DueRecheck, FocusCard, LaneView, LedgerRow, Owner, RecheckOutcome, RecheckQuestion, StepView,
    TaskDetail, TaskKind,
};
pub use store::Store;
