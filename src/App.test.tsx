import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { getBoard, resetAll } from "./lib/ipc/commands";
import type { BoardView } from "./lib/ipc/types";

vi.mock("./lib/ipc/commands", () => ({
  getBoard: vi.fn(),
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

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getBoard).mockReset();
  vi.mocked(resetAll).mockReset();
  vi.mocked(getBoard).mockResolvedValue(board);
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
});
