// The Atlas seam — where a source document becomes drafted task stubs.
// Stub copy transcribed from the design prototype
// (docs/design/project/"Slipway Sidebar.dc.html", renderVals `intakeStubs`).

import type { TaskKind } from "../ipc/types";

/** A drafted task stub before it lands on the board. */
export interface TaskStub {
  title: string;
  kind: TaskKind;
  effortMin: number;
}

/**
 * The Atlas seam: drafts task stubs (and later full learn-loops) from a
 * source document. v0.1 ships the deterministic stub generator below; the
 * future LLM/MCP integration replaces EXACTLY this function, nothing else.
 * This is the one interface and `IntakeOverlay` holds its one call site.
 */
export type DraftLearnLoops = (sourceText: string, sourceName: string) => TaskStub[];

/** The dropped doc's name minus its extension (prototype: `d.name.replace(...)`). */
export function baseName(sourceName: string): string {
  return sourceName.replace(/\.[a-z0-9]+$/i, "");
}

/**
 * v0.1 deterministic drafter: the prototype's three guesses. `sourceText`
 * is unused for now — it is in the signature because the real Atlas reads
 * the document body, and the seam must not change shape when it arrives.
 */
export const draftLearnLoops: DraftLearnLoops = (_sourceText, sourceName) => {
  const base = baseName(sourceName);
  return [
    { title: `Skim ${sourceName}`, kind: "action", effortMin: 5 },
    { title: `Extract the decisions from ${base}`, kind: "action", effortMin: 10 },
    { title: `First concrete action out of ${base}`, kind: "action", effortMin: 15 },
  ];
};
