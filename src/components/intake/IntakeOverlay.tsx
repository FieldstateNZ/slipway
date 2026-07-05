import { useCallback, useMemo, useState, type FormEvent } from "react";

import { draftLearnLoops, type TaskStub } from "../../lib/intake/atlas";
import {
  buildIntakePayload,
  buildManualTaskPayload,
  parseGraphDrop,
  type GraphPayload,
} from "../../lib/intake/payload";
import type { DroppedDoc } from "../../lib/intake/useWindowDrop";
import { importGraph } from "../../lib/ipc/commands";
import { KEY_PRIORITY, useKeyLayer } from "../../lib/keys";
import "./intake.css";

/** Sentinel select value for "start a fresh INBOX lane". */
const NEW_LANE = "__new__";

/** An existing lane offered by the manual-entry project select. */
export interface IntakeLaneOption {
  key: string;
  name: string;
}

export interface IntakeOverlayProps {
  /** Render the overlay. The component renders null when closed. */
  open: boolean;
  /** Close request — Esc, "i" (the toggle), the header "esc ✕". */
  onClose: () => void;
  /**
   * The dropped document, if any. App owns this state because drops land
   * while intake is closed (any window drop opens the overlay pre-filled).
   */
  dropped: DroppedDoc | null;
  /** "discard" clicked — App clears `dropped`, returning intake to empty. */
  onDiscard: () => void;
  /** Custom lanes already on the board — the next INBOX key is `in{N+1}`. */
  customCount: number;
  /** Existing lanes for the manual-entry project select. */
  lanes: IntakeLaneOption[];
  /**
   * A payload landed via import_graph. `projectKey` is the lane to activate
   * (null when a verbatim JSON import carries no projects); `toast` is the
   * footer copy. App refreshes, selects the lane, toasts, and closes intake.
   */
  onConfirmed: (projectKey: string | null, toast: string) => void;
}

/** One in-flight inline edit — a stub's title or effort minutes. */
interface StubEdit {
  index: number;
  field: "title" | "effort";
  value: string;
}

/** The drafted stubs, tagged with the doc they were drafted from. */
interface Draft {
  source: DroppedDoc | null;
  stubs: TaskStub[];
}

/** Intake — the mouth of the app. Drag-drop, manual entry, JSON import. */
export function IntakeOverlay({
  open,
  onClose,
  dropped,
  onDiscard,
  customCount,
  lanes,
  onConfirmed,
}: IntakeOverlayProps) {
  // A dropped .json file that already is an import-graph payload skips the
  // stub flow entirely and imports verbatim (no design mock — kept minimal).
  const graph = useMemo(
    () => (dropped === null ? null : parseGraphDrop(dropped.name, dropped.text)),
    [dropped],
  );

  const [draft, setDraft] = useState<Draft>({ source: null, stubs: [] });
  const [edit, setEdit] = useState<StubEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Manual entry — no design mock exists; a spartan form kept tokens-true.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualProject, setManualProject] = useState<string>(NEW_LANE);
  const [manualKind, setManualKind] = useState<"action" | "provide">("action");
  const [manualEffort, setManualEffort] = useState("5");
  const [manualDeps, setManualDeps] = useState("");

  // THE Atlas call site: every dropped doc is drafted into stubs here, and
  // only here. Edits then live in `draft` until confirm builds the payload.
  // Adjust-state-during-render (not an effect) so the stubs land in the SAME
  // commit as the doc — an Enter right after the drop must never confirm an
  // empty draft from the previous render.
  if (draft.source !== dropped) {
    setDraft({
      source: dropped,
      stubs: dropped !== null && graph === null ? draftLearnLoops(dropped.text, dropped.name) : [],
    });
    setEdit(null);
    setError(null);
  }
  const stubs = draft.stubs;

  const runImport = useCallback(
    (json: string, projectKey: string | null, toast: string) => {
      if (busy) return;
      setBusy(true);
      void (async () => {
        try {
          await importGraph(json);
          setError(null);
          onConfirmed(projectKey, toast);
        } catch (cause) {
          // Rejection stays inline; the overlay (and the draft) stay open.
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, onConfirmed],
  );

  const confirm = useCallback(() => {
    if (dropped === null) return;
    if (graph !== null) {
      runImport(
        graph.raw,
        graph.firstProjectKey,
        `${graph.taskCount} tasks docked — from ${dropped.name}`,
      );
      return;
    }
    const payload = buildIntakePayload(stubs, dropped.name, customCount);
    runImport(
      JSON.stringify(payload),
      payload.projects[0]?.key ?? null,
      `${stubs.length} tasks docked — from ${dropped.name}`,
    );
  }, [dropped, graph, stubs, customCount, runImport]);

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = manualTitle.trim();
    if (title === "") {
      setError("manual entry needs a title");
      return;
    }
    const deps = manualDeps
      .split(",")
      .map((dep) => dep.trim())
      .filter((dep) => dep !== "");
    const parsedEffort = Math.round(Number(manualEffort));
    const effortMin = Number.isFinite(parsedEffort) && parsedEffort > 0 ? parsedEffort : 0;
    let payload: GraphPayload;
    let laneKey: string | null;
    if (manualProject === NEW_LANE) {
      // Same shape either way: a fresh INBOX lane via the payload builder,
      // named after the task (the drop path names it after the doc).
      payload = buildIntakePayload([{ title, kind: manualKind, effortMin }], title, customCount);
      if (deps.length > 0) {
        payload = { ...payload, tasks: payload.tasks.map((task) => ({ ...task, deps })) };
      }
      laneKey = payload.projects[0]?.key ?? null;
    } else {
      payload = buildManualTaskPayload({
        projectKey: manualProject,
        title,
        kind: manualKind,
        effortMin,
        deps,
        nonce: `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      });
      laneKey = manualProject;
    }
    setManualTitle("");
    setManualDeps("");
    runImport(JSON.stringify(payload), laneKey, `1 task docked — ${title}`);
  };

  const commitEdit = useCallback(() => {
    if (edit === null) return;
    const { index, field, value } = edit;
    setDraft((prev) => ({
      ...prev,
      stubs: prev.stubs.map((stub, i) => {
        if (i !== index) return stub;
        if (field === "title") {
          const title = value.trim();
          return title === "" ? stub : { ...stub, title };
        }
        const minutes = Math.round(Number(value));
        return Number.isFinite(minutes) && minutes >= 0 ? { ...stub, effortMin: minutes } : stub;
      }),
    }));
    setEdit(null);
  }, [edit]);

  useKeyLayer(
    KEY_PRIORITY.OVERLAY,
    (event) => {
      if (event.key === "Escape" || event.key === "i") {
        onClose();
        return true;
      }
      if (event.key === "Enter" && dropped !== null) {
        confirm();
        return true;
      }
      return false;
    },
    open,
  );

  if (!open) return null;

  const editing = (index: number, field: StubEdit["field"]) =>
    edit !== null && edit.index === index && edit.field === field;

  const editInput = (className: string, type: "text" | "number") => (
    <input
      className={className}
      type={type}
      min={type === "number" ? 0 : undefined}
      value={edit?.value ?? ""}
      autoFocus
      onChange={(event) =>
        setEdit((prev) => (prev === null ? null : { ...prev, value: event.target.value }))
      }
      onBlur={commitEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commitEdit();
      }}
    />
  );

  return (
    <div className="sw-intake">
      <div className="sw-intake-head">
        <span className="sw-intake-title">Intake</span>
        <span className="sw-intake-tag">the mouth of the app</span>
        <span className="sw-intake-spacer" />
        <button type="button" className="sw-intake-close" onClick={onClose}>
          esc ✕
        </button>
      </div>
      <div className="sw-intake-body">
        {dropped !== null ? (
          <>
            <div className="sw-intake-chip">
              {`⌘ ${dropped.name}`}
              {dropped.size !== "" && <span className="sw-intake-chip-size">{dropped.size}</span>}
            </div>
            <div className="sw-intake-becomes">
              <span className="sw-intake-becomes-line" />
              <span className="sw-intake-becomes-label">BECOMES</span>
              <span className="sw-intake-becomes-line" />
            </div>
            {graph !== null ? (
              <>
                <div className="sw-intake-json-note">
                  {`a graph payload — ${graph.taskCount} tasks, imported verbatim`}
                </div>
                <button type="button" className="sw-intake-confirm" onClick={confirm}>
                  Import → board ↵
                </button>
              </>
            ) : (
              <>
                {stubs.map((stub, index) => (
                  <div className="sw-intake-stub" key={index}>
                    <div className="sw-intake-stub-head">
                      <span className="sw-intake-stub-meta">
                        {`${stub.kind} · you · `}
                        {editing(index, "effort") ? (
                          editInput("sw-intake-stub-eff-input", "number")
                        ) : (
                          <button
                            type="button"
                            className="sw-intake-stub-eff"
                            onClick={() =>
                              setEdit({ index, field: "effort", value: String(stub.effortMin) })
                            }
                          >
                            {`${stub.effortMin}m`}
                          </button>
                        )}
                      </span>
                      <span className="sw-intake-stub-spacer" />
                      <span className="sw-intake-stub-guess">guess</span>
                    </div>
                    {editing(index, "title") ? (
                      editInput("sw-intake-stub-title-input", "text")
                    ) : (
                      <button
                        type="button"
                        className="sw-intake-stub-title"
                        onClick={() => setEdit({ index, field: "title", value: stub.title })}
                      >
                        {stub.title}
                      </button>
                    )}
                  </div>
                ))}
                <div className="sw-intake-editnote">
                  every guess is editable before it lands · Atlas drafts the learn-loops from the
                  source
                </div>
                <button type="button" className="sw-intake-confirm" onClick={confirm}>
                  {`Confirm ${stubs.length} → new lane ↵`}
                </button>
              </>
            )}
            <button type="button" className="sw-intake-discard" onClick={onDiscard}>
              discard
            </button>
          </>
        ) : (
          <>
            <div className="sw-intake-dropzone">
              <div className="sw-intake-dropzone-main">
                drop a doc here — or anywhere on the board
              </div>
              <div className="sw-intake-dropzone-sub">
                a brief · a PR list · meeting notes · a wall of text
              </div>
            </div>
            <div className="sw-intake-note">
              v0.1 also takes manual entry + JSON import — same shape either way
            </div>
            {manualOpen ? (
              <form className="sw-intake-manual" onSubmit={submitManual}>
                <input
                  className="sw-intake-input"
                  aria-label="title"
                  placeholder="title"
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                />
                <div className="sw-intake-manual-row">
                  <select
                    className="sw-intake-input"
                    aria-label="project"
                    value={manualProject}
                    onChange={(event) => setManualProject(event.target.value)}
                  >
                    {lanes.map((lane) => (
                      <option key={lane.key} value={lane.key}>
                        {lane.name}
                      </option>
                    ))}
                    <option value={NEW_LANE}>new INBOX lane</option>
                  </select>
                  <select
                    className="sw-intake-input"
                    aria-label="kind"
                    value={manualKind}
                    onChange={(event) =>
                      setManualKind(event.target.value === "provide" ? "provide" : "action")
                    }
                  >
                    <option value="action">action</option>
                    <option value="provide">provide</option>
                  </select>
                  <input
                    className="sw-intake-input sw-intake-input-eff"
                    aria-label="effort minutes"
                    type="number"
                    min={0}
                    value={manualEffort}
                    onChange={(event) => setManualEffort(event.target.value)}
                  />
                </div>
                <input
                  className="sw-intake-input"
                  aria-label="deps"
                  placeholder="deps — task ids, comma-separated (optional)"
                  value={manualDeps}
                  onChange={(event) => setManualDeps(event.target.value)}
                />
                <button type="submit" className="sw-intake-confirm sw-intake-confirm-manual">
                  Add 1 → board ↵
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="sw-intake-manual-link"
                onClick={() => setManualOpen(true)}
              >
                manual entry
              </button>
            )}
          </>
        )}
        {error !== null && <div className="sw-intake-error">couldn’t import — {error}</div>}
      </div>
    </div>
  );
}
