import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import {
  answerRecheck,
  completeTask,
  getBoard,
  getDueRecheck,
  getLedger,
  getMap,
  getRecheck,
  getTaskDetail,
  resetAll,
} from "./lib/ipc/commands";
import type { BoardView, DueRecheck, LedgerRow, TaskDetail } from "./lib/ipc/types";

vi.mock("./lib/ipc/commands", () => ({
  getBoard: vi.fn(),
  getTaskDetail: vi.fn(),
  getMap: vi.fn(),
  resetAll: vi.fn(),
  completeTask: vi.fn(),
  importGraph: vi.fn(),
  getLedger: vi.fn(),
  getDueRecheck: vi.fn(),
  getRecheck: vi.fn(),
  answerRecheck: vi.fn(),
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

const oidcCapture = {
  concept_id: "oidc",
  name: "oidc trusted publishing",
  streak: 1,
  hollow: false,
  next_display: "~4d",
};

const ttlRecheck: DueRecheck = {
  concept_id: "ttl",
  name: "cache ttl + propagation",
  question: "You drop a TTL from 3600 to 300 right before a cutover. Why?",
  choices: [
    "Lower TTL makes DNS resolve faster",
    "Caches expire sooner, so the switch lands in minutes, not hours",
    "300 is the minimum for CNAMEs",
    "It forces resolvers to re-register the record",
  ],
  correct_index: 1,
  why: "TTL is just cache lifetime — shorter cache, faster convergence.",
};

const ledgerRows: LedgerRow[] = [
  {
    concept_id: "ttl",
    name: "cache ttl + propagation",
    from_task: "ds3",
    streak: 4,
    hollow: false,
    next_display: "30d",
    has_question: true,
  },
];

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getBoard).mockReset();
  vi.mocked(getTaskDetail).mockReset();
  vi.mocked(getMap).mockReset();
  vi.mocked(resetAll).mockReset();
  vi.mocked(completeTask).mockReset();
  vi.mocked(getLedger).mockReset();
  vi.mocked(getDueRecheck).mockReset();
  vi.mocked(getRecheck).mockReset();
  vi.mocked(answerRecheck).mockReset();
  vi.mocked(getBoard).mockResolvedValue(board);
  vi.mocked(getTaskDetail).mockResolvedValue(ds1Detail);
  vi.mocked(resetAll).mockResolvedValue(undefined);
  vi.mocked(getDueRecheck).mockResolvedValue(null);
  vi.mocked(getLedger).mockResolvedValue(ledgerRows);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Settle the IPC promise chains under fake timers. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function key(k: string) {
  fireEvent.keyDown(document, { key: k });
}

/** Open the ds1 drawer and walk its three steps into the capture phase. */
async function walkToCapture() {
  key("Enter");
  await flushMicrotasks();
  expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument();
  key("Enter");
  key("Enter");
  key("Enter");
  expect(screen.getByText("ONE TAP.")).toBeInTheDocument();
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
    expect(completeTask).not.toHaveBeenCalled();

    // Reopen the same task: the drawer restores steps phase at step 2.
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument());
    expect(screen.queryByText("STEP 1 OF 3")).not.toBeInTheDocument();
  });

  it("g toggles the map overlay and gates the board keys while it shows", async () => {
    vi.mocked(getMap).mockResolvedValue({
      chains: [
        {
          label: "DECISION STUDIO",
          pills: [
            {
              task_id: "ds1",
              short: "Short ds1",
              done: false,
              ready: true,
              owner: "you",
              flag: false,
            },
          ],
        },
      ],
    });
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "g" });
    await waitFor(() => expect(screen.getByText("The map")).toBeInTheDocument());
    expect(screen.getByText("on demand, never home")).toBeInTheDocument();

    // Board keys are dead while the overlay shows (prototype semantics):
    // Enter must not open the drawer behind the map.
    fireEvent.keyDown(document, { key: "Enter" });
    expect(getTaskDetail).not.toHaveBeenCalled();
    expect(container.querySelector(".sw-drawer")).not.toBeInTheDocument();

    // g toggles closed again (consumed by the overlay layer).
    fireEvent.keyDown(document, { key: "g" });
    expect(screen.queryByText("The map")).not.toBeInTheDocument();

    // With the drawer open, g must NOT open the map (overlays never cover
    // an open drawer in the prototype).
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "g" });
    expect(screen.queryByText("The map")).not.toBeInTheDocument();
  });

  it("l toggles the Learned ledger and gates the board keys while it shows", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());

    key("l");
    await waitFor(() => expect(screen.getByText("Learned")).toBeInTheDocument());
    expect(getLedger).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Evidence, not homework — rechecks ride along on the board."),
    ).toBeInTheDocument();

    // Board keys are dead while the ledger shows.
    key("Enter");
    expect(getTaskDetail).not.toHaveBeenCalled();
    expect(container.querySelector(".sw-drawer")).not.toBeInTheDocument();

    // l toggles closed again (consumed by the overlay layer).
    key("l");
    expect(screen.queryByText("Learned")).not.toBeInTheDocument();

    // Never over an open drawer.
    key("Enter");
    await waitFor(() => expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument());
    key("l");
    expect(screen.queryByText("Learned")).not.toBeInTheDocument();
  });

  it("the titlebar l button opens the ledger", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Learned" }));
    await waitFor(() => expect(screen.getByText("Learned")).toBeInTheDocument());
  });

  it("completes a task through the full capture flow: choreography + exact toast + fresh state", async () => {
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue({ task_id: "ds1", capture: oidcCapture });
    const { container } = render(<App />);
    await flushMicrotasks();

    await walkToCapture();
    key("2"); // The correct pick.
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds1", "correct");
    await flushMicrotasks();
    expect(screen.getByText("● oidc trusted publishing — captured")).toBeInTheDocument();

    // The drawer holds through the 900ms dwell, then finishes.
    expect(container.querySelector(".sw-drawer")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    await flushMicrotasks();

    // Drawer closed; the board runs the completion choreography.
    expect(container.querySelector(".sw-drawer")).not.toBeInTheDocument();
    expect(screen.getByText("✓ ds1")).toBeInTheDocument();
    expect(screen.getByText("advancing…")).toBeInTheDocument();
    expect(
      screen.getByText("● oidc trusted publishing — captured · resurfaces ~4d"),
    ).toBeInTheDocument();
    // Server state refetched: board again, and the ledger/due-recheck state.
    expect(getBoard).toHaveBeenCalledTimes(2);
    expect(getDueRecheck).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1150);
    });
    expect(screen.queryByText("advancing…")).not.toBeInTheDocument();
  });

  it("a completed task never restores stale parked state", async () => {
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue({ task_id: "ds1", capture: oidcCapture });
    const { container } = render(<App />);
    await flushMicrotasks();

    // Park mid-steps first, so a stale snapshot exists.
    key("Enter");
    await flushMicrotasks();
    key("Enter");
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
    key("Escape");

    // Reopen (restores), finish the task hollow.
    key("Enter");
    await flushMicrotasks();
    key("Enter");
    key("Enter");
    expect(screen.getByText("ONE TAP.")).toBeInTheDocument();
    key("s");
    await flushMicrotasks();
    expect(container.querySelector(".sw-drawer")).not.toBeInTheDocument();

    // Reopen ds1 (the fixture board still deals it): fresh at step 1.
    key("Enter");
    await flushMicrotasks();
    expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument();
  });

  it("ships the exact miss and hollow toast copy", async () => {
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue({ task_id: "ds1", capture: oidcCapture });
    render(<App />);
    await flushMicrotasks();

    // Miss: wrong pick, read the why, continue.
    await walkToCapture();
    key("1");
    expect(screen.getByText("→ this one")).toBeInTheDocument();
    key("Enter");
    await flushMicrotasks();
    expect(completeTask).toHaveBeenLastCalledWith("ds1", "miss");
    expect(
      screen.getByText("✕ oidc trusted publishing — the why is the win · back ~1d"),
    ).toBeInTheDocument();

    // Clear the toast window, then skip hollow.
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    await walkToCapture();
    key("s");
    await flushMicrotasks();
    expect(completeTask).toHaveBeenLastCalledWith("ds1", "hollow");
    expect(screen.getByText("◌ ds1 done, left hollow — it will ask again")).toBeInTheDocument();
  });

  it("offers the due recheck in the footer only when nothing else is talking", async () => {
    vi.mocked(getDueRecheck).mockResolvedValue(ttlRecheck);
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());

    const slot = () =>
      screen.queryByRole("button", { name: "[r] 20s recheck — cache ttl + propagation ◌" });
    await waitFor(() => expect(slot()).toBeInTheDocument());

    // Hidden while the drawer is open…
    key("Enter");
    await waitFor(() => expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument());
    expect(slot()).not.toBeInTheDocument();
    key("Escape");
    expect(slot()).toBeInTheDocument();

    // …while an overlay shows…
    key("l");
    await waitFor(() => expect(screen.getByText("Learned")).toBeInTheDocument());
    expect(slot()).not.toBeInTheDocument();
    key("Escape");
    expect(slot()).toBeInTheDocument();

    // …and while a toast shows.
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() => expect(screen.getByText("reset — fresh tide")).toBeInTheDocument());
    expect(slot()).not.toBeInTheDocument();
    expect(container.querySelector(".sw-recheck")).not.toBeInTheDocument();
  });

  it("r (and the footer slot) opens the quiz card in passing; answering refreshes the due state", async () => {
    vi.useFakeTimers();
    vi.mocked(getDueRecheck).mockResolvedValue(ttlRecheck);
    vi.mocked(answerRecheck).mockResolvedValue({ correct: true, streak: 5, next_display: "30d" });
    const { container } = render(<App />);
    await flushMicrotasks();

    key("r");
    expect(screen.getByText("20S RECHECK — IN PASSING")).toBeInTheDocument();
    expect(screen.getByText(ttlRecheck.question)).toBeInTheDocument();
    // The footer slot yields while the card shows.
    expect(
      screen.queryByRole("button", { name: "[r] 20s recheck — cache ttl + propagation ◌" }),
    ).not.toBeInTheDocument();

    // Nothing more is due once this one is answered.
    vi.mocked(getDueRecheck).mockResolvedValue(null);
    key("2");
    expect(answerRecheck).toHaveBeenCalledExactlyOnceWith("ttl", 1);
    await flushMicrotasks();
    expect(screen.getByText("● held — fades 30d")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1700);
    });
    await flushMicrotasks();
    expect(container.querySelector(".sw-recheck")).not.toBeInTheDocument();
    expect(getDueRecheck).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "[r] 20s recheck — cache ttl + propagation ◌" }),
    ).not.toBeInTheDocument();
  });

  it("ledger ask me opens the quiz over the ledger; Esc closes the quiz, not the ledger", async () => {
    vi.mocked(getRecheck).mockResolvedValue(ttlRecheck);
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());

    key("l");
    await waitFor(() => expect(screen.getByText("Learned")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "ask me" }));
    await waitFor(() => expect(getRecheck).toHaveBeenCalledExactlyOnceWith("ttl"));
    await waitFor(() => expect(screen.getByText("ASK ME — FROM THE LEDGER")).toBeInTheDocument());
    // The card renders over the still-open ledger.
    expect(screen.getByText("Learned")).toBeInTheDocument();

    // Esc hits the quiz layer first: card closes, ledger stays.
    key("Escape");
    expect(container.querySelector(".sw-recheck")).not.toBeInTheDocument();
    expect(screen.getByText("Learned")).toBeInTheDocument();

    // Esc again closes the ledger.
    key("Escape");
    expect(screen.queryByText("Learned")).not.toBeInTheDocument();
  });
});
