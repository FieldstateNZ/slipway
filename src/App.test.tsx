import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { getBoard, getTaskDetail, resetAll } from "./lib/ipc/commands";
import type { BoardView, TaskDetail } from "./lib/ipc/types";

vi.mock("./lib/ipc/commands", () => ({
  getBoard: vi.fn(),
  getTaskDetail: vi.fn(),
  resetAll: vi.fn(),
  completeTask: vi.fn(),
  importGraph: vi.fn(),
}));

const board: BoardView = {
  lanes: [
    {
      key: "ds",
      name: "DECISION STUDIO",
      full_name: "decision-studio",
      custom: false,
      focus: {
        id: "ds1",
        kind: "action",
        effort_min: 2,
        in_progress: false,
        title: "Title ds1",
        short: "Short ds1",
        sub: "Sub ds1",
        frees: "frees ds5",
      },
      queue: [
        {
          id: "ds1",
          kind: "action",
          effort_min: 2,
          in_progress: false,
          title: "Title ds1",
          short: "Short ds1",
          sub: "Sub ds1",
          frees: "frees ds5",
        },
      ],
      others_behind: 2,
      remaining_effort_min: 30,
    },
  ],
  ready_count: 4,
  ready_effort_min: 35,
};

// ds3-shaped detail for the board's dealt focus card ds1 (steps from the seed).
const ds1Detail: TaskDetail = {
  id: "ds1",
  kind: "action",
  effort_min: 2,
  title: "Title ds1",
  sub: "Sub ds1",
  frees: "frees ds5",
  project_full_name: "decision-studio",
  before: "Before ds1.",
  steps: [
    {
      text: "Add the record at your registrar",
      cmd: "schema.workspec.io  CNAME  fieldstatenz.github.io",
      concept_label: "why alias a name, not an IP",
      concept_text:
        "GitHub’s IPs change without notice. The alias follows them automatically; a hardcoded A record would break silently.",
    },
    {
      text: "Wait out propagation — minutes to an hour",
      cmd: null,
      concept_label: "what propagation actually is",
      concept_text:
        "Nothing is pushed anywhere — resolvers cache answers, and propagation is just those caches expiring. The record’s TTL decides how long stale answers linger.",
    },
    {
      text: "Confirm it resolves",
      cmd: "dig schema.workspec.io CNAME +short",
      concept_label: null,
      concept_text: null,
    },
  ],
  decision_options: [],
  capture: {
    question: "Why a CNAME here — not an A record?",
    choices: ["a", "b", "c", "d"],
    correct_index: 1,
    why: "why",
  },
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getBoard).mockReset();
  vi.mocked(getTaskDetail).mockReset();
  vi.mocked(resetAll).mockReset();
  vi.mocked(getBoard).mockResolvedValue(board);
  vi.mocked(getTaskDetail).mockResolvedValue(ds1Detail);
  vi.mocked(resetAll).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Settle the getBoard/resetAll promise chains under fake timers. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("App", () => {
  it("renders the app shell", async () => {
    const { container } = render(<App />);
    expect(container.querySelector(".sw-app")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());
  });

  it("composes titlebar, board, and footer with the real ready summary", async () => {
    const { container } = render(<App />);
    expect(container.querySelector(".sw-titlebar")).toBeInTheDocument();
    expect(container.querySelector(".sw-main")).toBeInTheDocument();
    expect(container.querySelector(".sw-footer")).toBeInTheDocument();
    // Placeholder summary until get_board resolves, then the real one.
    expect(screen.getByText("0 ready · 0m")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("4 ready · 35m")).toBeInTheDocument());
    expect(container.querySelector(".sw-lane")).toBeInTheDocument();
  });

  it("footer reset wipes state, refreshes, and toasts for 2.5s", async () => {
    vi.useFakeTimers();
    render(<App />);
    await flushMicrotasks();
    expect(screen.getByText("Short ds1")).toBeInTheDocument();
    expect(getBoard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await flushMicrotasks();
    expect(resetAll).toHaveBeenCalledTimes(1);
    expect(getBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("reset — fresh tide")).toBeInTheDocument();

    // The reset toast clears after 2.5s (prototype resetAll timing).
    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.getByText("reset — fresh tide")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("reset — fresh tide")).not.toBeInTheDocument();
  });

  it("Enter on the focused card opens the task drawer over the board", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Enter" });
    expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith("ds1");
    await waitFor(() => expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument());
    expect(container.querySelector(".sw-drawer")).toBeInTheDocument();
    // The board stays mounted underneath.
    expect(container.querySelector(".sw-lane")).toBeInTheDocument();
  });

  it("esc parks the drawer without completing; reopening restores phase + step index", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());

    // Open and advance to step 2.
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();

    // Esc parks: drawer gone, nothing completed.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".sw-drawer")).not.toBeInTheDocument();

    // Reopen the same task: the drawer restores steps phase at step 2.
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument());
    expect(screen.queryByText("STEP 1 OF 3")).not.toBeInTheDocument();
  });
});
