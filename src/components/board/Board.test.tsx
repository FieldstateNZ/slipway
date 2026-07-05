import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useCallback, useState, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import seedRaw from "../../../seed/launch-graph.json?raw";
import { importGraph } from "../../lib/ipc/commands";
import type { BoardView, FocusCard as FocusCardData, LaneView } from "../../lib/ipc/types";
import { SETTINGS_STORAGE_KEY, SettingsProvider } from "../../lib/settings";
import { Board, type BoardHandle } from "./Board";

vi.mock("../../lib/ipc/commands", () => ({
  importGraph: vi.fn(),
}));

function card(id: string, over: Partial<FocusCardData> = {}): FocusCardData {
  return {
    id,
    kind: "action",
    effort_min: 5,
    in_progress: false,
    title: `Title ${id}`,
    short: `Short ${id}`,
    sub: `Sub ${id}`,
    frees: `frees ${id}`,
    ...over,
  };
}

function laneOf(
  key: string,
  name: string,
  queue: FocusCardData[],
  over: Partial<LaneView> = {},
): LaneView {
  return {
    key,
    name,
    full_name: name.toLowerCase(),
    custom: false,
    focus: queue[0] ?? null,
    queue,
    others_behind: Math.max(0, queue.length - 1),
    remaining_effort_min: queue.reduce((sum, c) => sum + c.effort_min, 0),
    ...over,
  };
}

// Mirrors the seed: ds focus ds1 (2 more queued), lm focus lm1, sw focus sw1 in progress.
function makeBoard(): BoardView {
  return {
    lanes: [
      laneOf("ds", "DECISION STUDIO", [
        card("ds1"),
        card("ds2"),
        card("ds4", { kind: "decision" }),
      ]),
      laneOf("lm", "LOOM", [card("lm1")]),
      laneOf("sw", "SLIPWAY", [card("sw1", { in_progress: true, effort_min: 0 })]),
    ],
    ready_count: 5,
    ready_effort_min: 39,
  };
}

// Board state after ds1 completes: ds now deals ds2, with ds4 behind it.
function makeBoardAfter(): BoardView {
  const board = makeBoard();
  board.lanes[0] = laneOf("ds", "DECISION STUDIO", [
    card("ds2"),
    card("ds4", { kind: "decision" }),
  ]);
  return board;
}

interface HarnessProps {
  initial: BoardView;
  after: BoardView;
  onOpenTask: (taskId: string) => void;
  onToast: (toast: string) => void;
  handleRef?: Ref<BoardHandle>;
}

/** Owns the board prop the way App does, so `refresh` swaps in fresh state. */
function Harness({ initial, after, onOpenTask, onToast, handleRef }: HarnessProps) {
  const [board, setBoard] = useState(initial);
  const refresh = useCallback(async () => {
    setBoard(after);
  }, [after]);
  return (
    <SettingsProvider>
      <Board
        board={board}
        refresh={refresh}
        onOpenTask={onOpenTask}
        onToast={onToast}
        ref={handleRef}
      />
    </SettingsProvider>
  );
}

function renderBoard(over: Partial<HarnessProps> = {}) {
  const onOpenTask = vi.fn();
  const onToast = vi.fn();
  const initial = over.initial ?? makeBoard();
  const utils = render(
    <Harness
      initial={initial}
      after={over.after ?? initial}
      onOpenTask={over.onOpenTask ?? onOpenTask}
      onToast={over.onToast ?? onToast}
      handleRef={over.handleRef}
    />,
  );
  return { ...utils, onOpenTask, onToast };
}

function key(k: string) {
  fireEvent.keyDown(document, { key: k });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(importGraph).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Board — lanes of one", () => {
  it("deals exactly one focus card per lane, never a list", () => {
    const { container } = renderBoard();
    const lanes = container.querySelectorAll(".sw-lane");
    expect(lanes).toHaveLength(3);
    expect(container.querySelectorAll(".sw-focus")).toHaveLength(3);
    for (const lane of lanes) {
      expect(lane.querySelectorAll(".sw-focus, .sw-wait")).toHaveLength(1);
    }
    // Queued ds tasks stay whispers, not cards.
    expect(screen.queryByText("Short ds2")).not.toBeInTheDocument();
    expect(screen.queryByText("Short ds4")).not.toBeInTheDocument();
  });

  it("renders a WaitingCard for a lane with nothing owner-you and ready", () => {
    const initial = makeBoard();
    initial.lanes[1] = laneOf("lm", "LOOM", []);
    const { container } = renderBoard({ initial });
    const lmLane = container.querySelectorAll(".sw-lane")[1];
    expect(lmLane?.querySelector(".sw-wait")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs you here")).toBeInTheDocument();
    // textContent keeps the double space after "▸ ▸ ▸" that RTL's matcher collapses.
    expect(lmLane?.querySelector(".sw-wait-sub")?.textContent).toBe(
      "▸ ▸ ▸  pipeline carries it — staging + harness next",
    );
    expect(lmLane?.querySelector(".sw-lane-whisper")).toHaveTextContent(
      "yours done — others finishing",
    );
  });

  it("shows the in-progress meta and lane whispers from the fixture", () => {
    renderBoard();
    expect(screen.getByText("● in progress — this session")).toBeInTheDocument();
    expect(screen.getByText("then atlas → pipeline → you")).toBeInTheDocument();
    expect(screen.getByText("2 behind · ≈15m to launch")).toBeInTheDocument();
  });
});

describe("Board — selection and keyboard", () => {
  it("selects lanes with digits 1–9 only when the lane exists", () => {
    const { container } = renderBoard();
    const cards = () => container.querySelectorAll(".sw-focus");
    expect(cards()[0]).toHaveClass("sw-focus-active");
    key("2");
    expect(cards()[0]).not.toHaveClass("sw-focus-active");
    expect(cards()[1]).toHaveClass("sw-focus-active");
    key("9"); // No lane 9 — selection must not move.
    expect(cards()[1]).toHaveClass("sw-focus-active");
    key("3");
    expect(cards()[2]).toHaveClass("sw-focus-active");
  });

  it("selects a lane on click", () => {
    const { container } = renderBoard();
    const lanes = container.querySelectorAll(".sw-lane");
    fireEvent.click(lanes[2] as Element);
    expect(container.querySelectorAll(".sw-focus")[2]).toHaveClass("sw-focus-active");
  });

  it("Tab deals the next queued card in the active lane, wrapping", () => {
    renderBoard();
    expect(screen.getByText("Short ds1")).toBeInTheDocument();
    key("Tab");
    expect(screen.getByText("Short ds2")).toBeInTheDocument();
    expect(screen.queryByText("Short ds1")).not.toBeInTheDocument();
    key("Tab");
    expect(screen.getByText("Short ds4")).toBeInTheDocument();
    key("Tab");
    expect(screen.getByText("Short ds1")).toBeInTheDocument();
  });

  it("Tab does not deal in a lane with a single ready task", () => {
    renderBoard();
    key("2");
    key("Tab");
    expect(screen.getByText("Short lm1")).toBeInTheDocument();
    expect(screen.getByText("Short ds1")).toBeInTheDocument();
  });

  it("Enter opens the dealt focus card of the active lane", () => {
    const { onOpenTask } = renderBoard();
    key("Enter");
    expect(onOpenTask).toHaveBeenCalledWith("ds1");
    key("Tab");
    key("Enter");
    expect(onOpenTask).toHaveBeenLastCalledWith("ds2");
    key("3");
    key("Enter");
    expect(onOpenTask).toHaveBeenLastCalledWith("sw1");
  });

  it("clicking a focus card opens it", () => {
    const { onOpenTask } = renderBoard();
    fireEvent.click(screen.getByText("Short ds1"));
    expect(onOpenTask).toHaveBeenCalledWith("ds1");
  });
});

describe("Board — completion choreography", () => {
  it("slides the ✓ pill out, shows advancing…, then docks the next card after 1150ms", () => {
    vi.useFakeTimers();
    const handleRef = createRef<BoardHandle>();
    const { container, onToast } = renderBoard({ after: makeBoardAfter(), handleRef });

    // The S5 capture reports completions through the handle.
    act(() => {
      handleRef.current?.onCompleted(
        "ds1",
        "ds",
        "● oidc trusted publishing — captured · resurfaces ~4d",
      );
    });

    expect(screen.getByText("✓ ds1")).toBeInTheDocument();
    expect(screen.getByText("advancing…")).toBeInTheDocument();
    const dsLane = container.querySelectorAll(".sw-lane")[0];
    expect(dsLane?.querySelector(".sw-lane-whisper")).toHaveTextContent("");
    expect(onToast).toHaveBeenCalledWith("● oidc trusted publishing — captured · resurfaces ~4d");
    // The refreshed board already deals the next card while the pill slides.
    expect(screen.getByText("Short ds2")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText("✓ ds1")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByText("✓ ds1")).not.toBeInTheDocument();
    expect(screen.queryByText("advancing…")).not.toBeInTheDocument();
    expect(screen.getByText("Short ds2")).toBeInTheDocument();
  });

  it("clears the advancing state after 60ms when reducedMotion is on", () => {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ reducedMotion: true, keyHints: true }),
    );
    vi.useFakeTimers();
    const handleRef = createRef<BoardHandle>();
    renderBoard({ after: makeBoardAfter(), handleRef });

    act(() => {
      handleRef.current?.onCompleted("ds1", "ds", "toast");
    });
    expect(screen.getByText("✓ ds1")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.queryByText("✓ ds1")).not.toBeInTheDocument();
  });

  it("resets the lane's deal offset when a task completes", () => {
    vi.useFakeTimers();
    const handleRef = createRef<BoardHandle>();
    renderBoard({ after: makeBoardAfter(), handleRef });

    key("Tab"); // Deal ds2 to the front…
    expect(screen.getByText("Short ds2")).toBeInTheDocument();
    act(() => {
      handleRef.current?.onCompleted("ds2", "ds", "toast"); // …and complete it.
    });

    // Offset snapped back to 0: the refreshed queue head (ds2) is dealt,
    // not the card at the stale offset (ds4).
    expect(screen.getByText("Short ds2")).toBeInTheDocument();
    expect(screen.queryByText("Short ds4")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1150);
    });
    expect(screen.queryByText("advancing…")).not.toBeInTheDocument();
  });

  it("exposes onCompleted through the handle for the S4/S5 callers", () => {
    const handleRef = createRef<BoardHandle>();
    const { onToast } = renderBoard({ after: makeBoardAfter(), handleRef });

    act(() => {
      handleRef.current?.onCompleted("ds1", "ds", "custom toast");
    });

    expect(onToast).toHaveBeenCalledWith("custom toast");
    expect(screen.getByText("✓ ds1")).toBeInTheDocument();
    expect(screen.getByText("advancing…")).toBeInTheDocument();
  });
});

describe("Board — empty board", () => {
  it("offers the bundled launch graph and imports it", async () => {
    vi.mocked(importGraph).mockResolvedValue(undefined);
    const empty: BoardView = { lanes: [], ready_count: 0, ready_effort_min: 0 };
    renderBoard({ initial: empty, after: makeBoard() });

    expect(screen.getByText("or drop a doc — intake takes it from here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "load the launch graph" }));

    await waitFor(() => expect(importGraph).toHaveBeenCalledWith(seedRaw));
    await waitFor(() => expect(screen.getByText("Short ds1")).toBeInTheDocument());
  });
});
