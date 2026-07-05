import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBoard } from "../ipc/commands";
import type { BoardView } from "../ipc/types";
import { useBoard } from "./useBoard";

vi.mock("../ipc/commands", () => ({
  getBoard: vi.fn(),
}));

const first: BoardView = { lanes: [], ready_count: 1, ready_effort_min: 5 };
const second: BoardView = { lanes: [], ready_count: 2, ready_effort_min: 10 };

beforeEach(() => {
  vi.mocked(getBoard).mockReset();
});

afterEach(cleanup);

describe("useBoard", () => {
  it("starts null and fetches the board on mount", async () => {
    vi.mocked(getBoard).mockResolvedValue(first);
    const { result } = renderHook(() => useBoard());
    expect(result.current.board).toBeNull();
    await waitFor(() => expect(result.current.board).toEqual(first));
    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it("refresh refetches server state", async () => {
    vi.mocked(getBoard).mockResolvedValue(first);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.board).toEqual(first));

    vi.mocked(getBoard).mockResolvedValue(second);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.board).toEqual(second);
  });
});
