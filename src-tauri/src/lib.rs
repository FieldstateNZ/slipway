//! Tauri glue: owns the SQLite store and exposes the typed IPC commands.
//! Mirror types live in `src/lib/ipc/types.ts`.

use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use slipway_core::{
    BoardView, CaptureResult, CompleteResult, DueRecheck, LedgerRow, MapView, RecheckOutcome,
    Store, TaskDetail,
};
use tauri::{Manager, State};

/// Managed application state: a single SQLite connection behind a mutex.
struct Db(Mutex<Store>);

type CmdResult<T> = Result<T, String>;

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn lock<'a>(db: &'a State<'_, Db>) -> Result<MutexGuard<'a, Store>, String> {
    db.0.lock().map_err(|_| "store lock poisoned".to_string())
}

fn err(e: slipway_core::Error) -> String {
    e.to_string()
}

/// Per-lane board data plus the app-level ready summary.
#[tauri::command(rename_all = "snake_case")]
fn get_board(db: State<'_, Db>) -> CmdResult<BoardView> {
    lock(&db)?.board().map_err(err)
}

/// The map overlay: dependency chains as pill rows.
#[tauri::command(rename_all = "snake_case")]
fn get_map(db: State<'_, Db>) -> CmdResult<MapView> {
    lock(&db)?.map().map_err(err)
}

/// Full drawer detail for a task.
#[tauri::command(rename_all = "snake_case")]
fn get_task_detail(db: State<'_, Db>, task_id: String) -> CmdResult<TaskDetail> {
    lock(&db)?.task_detail(&task_id).map_err(err)
}

/// Mark a task done, record the decision choice if any, and append the
/// capture outcome to the loop's concept.
#[tauri::command(rename_all = "snake_case")]
fn complete_task(
    db: State<'_, Db>,
    task_id: String,
    outcome: CaptureResult,
    decision_choice: Option<usize>,
) -> CmdResult<CompleteResult> {
    lock(&db)?
        .complete_task(&task_id, outcome, decision_choice, unix_now())
        .map_err(err)
}

/// Ledger rows in first-capture order.
#[tauri::command(rename_all = "snake_case")]
fn get_ledger(db: State<'_, Db>) -> CmdResult<Vec<LedgerRow>> {
    lock(&db)?.ledger().map_err(err)
}

/// The single most-overdue recheck, if any concept is due right now.
#[tauri::command(rename_all = "snake_case")]
fn get_due_recheck(db: State<'_, Db>) -> CmdResult<Option<DueRecheck>> {
    lock(&db)?.due_recheck(unix_now()).map_err(err)
}

/// The recheck quiz for one concept regardless of due-ness (ledger "ask me").
#[tauri::command(rename_all = "snake_case")]
fn get_recheck(db: State<'_, Db>, concept_id: String) -> CmdResult<DueRecheck> {
    lock(&db)?.recheck_for(&concept_id).map_err(err)
}

/// Grade a recheck answer; returns whether it was right plus the updated
/// "next" display.
#[tauri::command(rename_all = "snake_case")]
fn answer_recheck(
    db: State<'_, Db>,
    concept_id: String,
    choice_index: usize,
) -> CmdResult<RecheckOutcome> {
    lock(&db)?
        .answer_recheck(&concept_id, choice_index, unix_now())
        .map_err(err)
}

/// Import a graph JSON payload (same schema as `seed/launch-graph.json`).
#[tauri::command(rename_all = "snake_case")]
fn import_graph(db: State<'_, Db>, json_string: String) -> CmdResult<()> {
    lock(&db)?
        .import_graph_json(&json_string, unix_now())
        .map_err(err)
}

/// Wipe all rows (footer reset).
#[tauri::command(rename_all = "snake_case")]
fn reset_all(db: State<'_, Db>) -> CmdResult<()> {
    lock(&db)?.reset_all().map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = Store::open(dir.join("slipway.db"))?;
            app.manage(Db(Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_board,
            get_map,
            get_task_detail,
            complete_task,
            get_ledger,
            get_due_recheck,
            get_recheck,
            answer_recheck,
            import_graph,
            reset_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
