import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DroppedDoc } from "../../lib/intake/useWindowDrop";
import { importGraph } from "../../lib/ipc/commands";
import { IntakeOverlay, type IntakeOverlayProps } from "./IntakeOverlay";

vi.mock("../../lib/ipc/commands", () => ({
  importGraph: vi.fn(),
}));

const dropped: DroppedDoc = { name: "q3-brief.md", size: "12 kb", text: "the brief body" };

function makeProps(overrides: Partial<IntakeOverlayProps> = {}): IntakeOverlayProps {
  return {
    open: true,
    onClose: vi.fn(),
    dropped: null,
    onDiscard: vi.fn(),
    customCount: 0,
    lanes: [{ key: "ds", name: "DECISION STUDIO" }],
    onConfirmed: vi.fn(),
    ...overrides,
  };
}

/** The one importGraph argument, parsed back into a graph object. */
function importedPayload(call = 0) {
  const json = vi.mocked(importGraph).mock.calls[call]?.[0];
  expect(typeof json).toBe("string");
  return JSON.parse(json as string) as {
    version: number;
    projects: { key: string; name: string; full_name: string; custom: boolean }[];
    concepts: { id: string }[];
    tasks: {
      id: string;
      project: string;
      deps: string[];
      kind: string;
      effort_min: number;
      title: string;
    }[];
    seed_learned: unknown[];
  };
}

beforeEach(() => {
  vi.mocked(importGraph).mockReset();
  vi.mocked(importGraph).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("IntakeOverlay", () => {
  it("renders null when closed", () => {
    const { container } = render(<IntakeOverlay {...makeProps({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the header and the exact empty-state copy", () => {
    render(<IntakeOverlay {...makeProps()} />);
    expect(screen.getByText("Intake")).toBeInTheDocument();
    expect(screen.getByText("the mouth of the app")).toBeInTheDocument();
    expect(screen.getByText("esc ✕")).toBeInTheDocument();
    expect(screen.getByText("drop a doc here — or anywhere on the board")).toBeInTheDocument();
    expect(
      screen.getByText("a brief · a PR list · meeting notes · a wall of text"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("v0.1 also takes manual entry + JSON import — same shape either way"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "manual entry" })).toBeInTheDocument();
  });

  it("Esc and i close via the overlay key layer", () => {
    const props = makeProps();
    render(<IntakeOverlay {...props} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "i" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("dropped state: chip, BECOMES, three editable stubs, confirm, discard", () => {
    const { container } = render(<IntakeOverlay {...makeProps({ dropped })} />);
    expect(screen.getByText("⌘ q3-brief.md")).toBeInTheDocument();
    expect(screen.getByText("12 kb")).toBeInTheDocument();
    expect(screen.getByText("BECOMES")).toBeInTheDocument();
    const metas = [...container.querySelectorAll(".sw-intake-stub-meta")].map(
      (meta) => meta.textContent,
    );
    expect(metas).toEqual(["action · you · 5m", "action · you · 10m", "action · you · 15m"]);
    expect(screen.getAllByText("guess")).toHaveLength(3);
    expect(screen.getByText("Skim q3-brief.md")).toBeInTheDocument();
    expect(screen.getByText("Extract the decisions from q3-brief")).toBeInTheDocument();
    expect(screen.getByText("First concrete action out of q3-brief")).toBeInTheDocument();
    expect(
      screen.getByText(
        "every guess is editable before it lands · Atlas drafts the learn-loops from the source",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm 3 → new lane ↵" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "discard" })).toBeInTheDocument();
  });

  it("inline edits land in the imported payload", async () => {
    const props = makeProps({ dropped });
    const { container } = render(<IntakeOverlay {...props} />);

    // Title: click → input, Enter commits.
    fireEvent.click(screen.getByText("Skim q3-brief.md"));
    const titleInput = container.querySelector(".sw-intake-stub-title-input");
    expect(titleInput).not.toBeNull();
    fireEvent.change(titleInput as Element, { target: { value: "Read it properly" } });
    fireEvent.keyDown(titleInput as Element, { key: "Enter" });
    expect(screen.getByText("Read it properly")).toBeInTheDocument();

    // Effort: click the minutes → number input, blur commits.
    fireEvent.click(screen.getByText("10m"));
    const effortInput = container.querySelector(".sw-intake-stub-eff-input");
    expect(effortInput).not.toBeNull();
    fireEvent.change(effortInput as Element, { target: { value: "25" } });
    fireEvent.blur(effortInput as Element);
    expect(screen.getByText("25m")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm 3 → new lane ↵" }));
    await waitFor(() => expect(importGraph).toHaveBeenCalledTimes(1));
    const payload = importedPayload();
    expect(payload.tasks[0]?.title).toBe("Read it properly");
    expect(payload.tasks[1]?.effort_min).toBe(25);
    expect(payload.tasks[2]?.title).toBe("First concrete action out of q3-brief");
    expect(payload.projects[0]?.key).toBe("in1");
    await waitFor(() =>
      expect(props.onConfirmed).toHaveBeenCalledExactlyOnceWith(
        "in1",
        "3 tasks docked — from q3-brief.md",
      ),
    );
  });

  it("Enter confirms while a doc is dropped", async () => {
    const props = makeProps({ dropped, customCount: 1 });
    render(<IntakeOverlay {...props} />);
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(importGraph).toHaveBeenCalledTimes(1));
    expect(importedPayload().projects[0]?.key).toBe("in2");
    await waitFor(() =>
      expect(props.onConfirmed).toHaveBeenCalledExactlyOnceWith(
        "in2",
        "3 tasks docked — from q3-brief.md",
      ),
    );
  });

  it("discard hands back to App; without a doc the empty state returns", () => {
    const props = makeProps({ dropped });
    const { rerender } = render(<IntakeOverlay {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "discard" }));
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
    rerender(<IntakeOverlay {...props} dropped={null} />);
    expect(screen.getByText("drop a doc here — or anywhere on the board")).toBeInTheDocument();
    expect(screen.queryByText("⌘ q3-brief.md")).not.toBeInTheDocument();
  });

  it("an importGraph rejection shows inline and keeps the draft", async () => {
    vi.mocked(importGraph).mockRejectedValue(new Error("dependency cycle: in1-1"));
    const props = makeProps({ dropped });
    render(<IntakeOverlay {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm 3 → new lane ↵" }));
    await waitFor(() =>
      expect(screen.getByText("couldn’t import — dependency cycle: in1-1")).toBeInTheDocument(),
    );
    expect(props.onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByText("Skim q3-brief.md")).toBeInTheDocument();
  });

  it("manual entry appends one task to an existing lane through the same import", async () => {
    const props = makeProps();
    render(<IntakeOverlay {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "manual entry" }));
    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "Chase the DNS ticket" },
    });
    fireEvent.change(screen.getByLabelText("project"), { target: { value: "ds" } });
    fireEvent.change(screen.getByLabelText("kind"), { target: { value: "provide" } });
    fireEvent.change(screen.getByLabelText("effort minutes"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("deps"), { target: { value: "ds1, ds2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 → board ↵" }));

    await waitFor(() => expect(importGraph).toHaveBeenCalledTimes(1));
    const payload = importedPayload();
    expect(payload.projects).toEqual([]);
    expect(payload.concepts[0]?.id).toBe("intake");
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]?.id).toMatch(/^ds-m/);
    expect(payload.tasks[0]?.project).toBe("ds");
    expect(payload.tasks[0]?.kind).toBe("provide");
    expect(payload.tasks[0]?.effort_min).toBe(30);
    expect(payload.tasks[0]?.deps).toEqual(["ds1", "ds2"]);
    await waitFor(() =>
      expect(props.onConfirmed).toHaveBeenCalledExactlyOnceWith(
        "ds",
        "1 task docked — Chase the DNS ticket",
      ),
    );
  });

  it("manual entry can open a fresh INBOX lane via the payload builder", async () => {
    const props = makeProps();
    render(<IntakeOverlay {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "manual entry" }));
    fireEvent.change(screen.getByLabelText("title"), { target: { value: "Fix the roof" } });
    // The project select defaults to "new INBOX lane".
    fireEvent.click(screen.getByRole("button", { name: "Add 1 → board ↵" }));

    await waitFor(() => expect(importGraph).toHaveBeenCalledTimes(1));
    const payload = importedPayload();
    expect(payload.projects[0]).toEqual({
      key: "in1",
      name: "INBOX — FIX THE ROOF",
      full_name: "inbox",
      custom: true,
    });
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]?.id).toBe("in1-1");
    await waitFor(() =>
      expect(props.onConfirmed).toHaveBeenCalledExactlyOnceWith(
        "in1",
        "1 task docked — Fix the roof",
      ),
    );
  });

  it("a dropped graph .json skips the stub flow and imports verbatim", async () => {
    const raw = JSON.stringify({
      version: 1,
      projects: [{ key: "zz", name: "ZED", full_name: "zed", custom: true }],
      concepts: [],
      tasks: [{ id: "zz-1" }, { id: "zz-2" }],
      seed_learned: [],
    });
    const props = makeProps({ dropped: { name: "graph.json", size: "1 kb", text: raw } });
    render(<IntakeOverlay {...props} />);
    expect(screen.getByText("⌘ graph.json")).toBeInTheDocument();
    expect(screen.getByText("a graph payload — 2 tasks, imported verbatim")).toBeInTheDocument();
    expect(screen.queryByText("guess")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import → board ↵" }));
    await waitFor(() => expect(importGraph).toHaveBeenCalledExactlyOnceWith(raw));
    await waitFor(() =>
      expect(props.onConfirmed).toHaveBeenCalledExactlyOnceWith(
        "zz",
        "2 tasks docked — from graph.json",
      ),
    );
  });
});
