import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMap } from "../../lib/ipc/commands";
import type { MapView, PillView } from "../../lib/ipc/types";
import { MapOverlay } from "./MapOverlay";

vi.mock("../../lib/ipc/commands", () => ({
  getMap: vi.fn(),
}));

const getMapMock = vi.mocked(getMap);

function pill(taskId: string, over: Partial<PillView> = {}): PillView {
  return {
    task_id: taskId,
    short: `short ${taskId}`,
    done: false,
    ready: false,
    owner: "you",
    flag: false,
    ...over,
  };
}

// One chain exercising all five pill states, including a >22-char short that
// must truncate, plus a single-pill chain (no arrows).
function makeMap(): MapView {
  return {
    chains: [
      {
        label: "DECISION STUDIO — PATH B · ◆ds9 joins at ds7",
        pills: [
          pill("ds1", { done: true }),
          pill("ds5", { ready: true, short: "npm trusted publishers ×4" }),
          pill("ds7", { short: "Cut first release" }),
          pill("ds8", { owner: "atlas", short: "Marketing copy — you skim" }),
          pill("launch", { flag: true, short: "" }),
        ],
      },
      {
        label: "SLIPWAY",
        pills: [pill("v0.1", { flag: true, short: "" })],
      },
    ],
  };
}

function renderMap(over: Partial<Parameters<typeof MapOverlay>[0]> = {}) {
  getMapMock.mockResolvedValue(makeMap());
  const onClose = vi.fn();
  const utils = render(<MapOverlay open onClose={onClose} {...over} />);
  return { ...utils, onClose };
}

async function settled() {
  await screen.findByText("SLIPWAY");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MapOverlay", () => {
  it("renders nothing (and fetches nothing) when closed", () => {
    getMapMock.mockResolvedValue(makeMap());
    const { container } = render(<MapOverlay open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(getMapMock).not.toHaveBeenCalled();
  });

  it("shows the exact header and legend copy", async () => {
    renderMap();
    await settled();
    expect(screen.getByText("The map")).toHaveClass("sw-map-title");
    expect(screen.getByText("on demand, never home")).toHaveClass("sw-map-tag");
    expect(screen.getByText("esc ✕")).toHaveClass("sw-map-close");
    expect(screen.getByText("lit = ready · dashed = waiting · ✓ = done")).toHaveClass(
      "sw-map-legend",
    );
  });

  it("renders chain labels verbatim", async () => {
    renderMap();
    await settled();
    expect(screen.getByText("DECISION STUDIO — PATH B · ◆ds9 joins at ds7")).toHaveClass(
      "sw-map-chain-label",
    );
    expect(screen.getByText("SLIPWAY")).toHaveClass("sw-map-chain-label");
  });

  it("renders all five pill states with their classes and labels", async () => {
    renderMap();
    await settled();

    const done = screen.getByText("✓ ds1");
    expect(done).toHaveClass("sw-map-pill", "sw-map-pill-done");

    // Ready + yours, with the design's exact truncation (25 chars → 21 + …).
    const ready = screen.getByText("ds5 · npm trusted publisher…");
    expect(ready).toHaveClass("sw-map-pill", "sw-map-pill-ready");

    const waiting = screen.getByText("ds7 · Cut first release");
    expect(waiting).toHaveClass("sw-map-pill", "sw-map-pill-waiting");

    // Other-owner pills append the owner and truncate the same way.
    const other = screen.getByText("ds8 · Marketing copy — you … · atlas");
    expect(other).toHaveClass("sw-map-pill", "sw-map-pill-other");

    const flag = screen.getByText("⚑ launch");
    expect(flag).toHaveClass("sw-map-pill", "sw-map-pill-flag");
    expect(screen.getByText("⚑ v0.1")).toHaveClass("sw-map-pill", "sw-map-pill-flag");
  });

  it("separates pills with borderless arrows", async () => {
    renderMap();
    await settled();
    // 5 pills in the first chain → 4 arrows; the single-pill chain adds none.
    const arrows = screen.getAllByText("→");
    expect(arrows).toHaveLength(4);
    for (const arrow of arrows) {
      expect(arrow).toHaveClass("sw-map-arrow");
    }
  });

  it("closes on Escape and on g (prototype toggle)", async () => {
    const { onClose } = renderMap();
    await settled();
    fireEvent.keyDown(document, { key: "x" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "g" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not eat keys while closed", () => {
    getMapMock.mockResolvedValue(makeMap());
    const onClose = vi.fn();
    render(<MapOverlay open={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "g" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the header esc ✕ is clicked", async () => {
    const { onClose } = renderMap();
    await settled();
    fireEvent.click(screen.getByText("esc ✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refetches on every open and on version bumps while open", async () => {
    getMapMock.mockResolvedValue(makeMap());
    const { rerender } = render(<MapOverlay open onClose={vi.fn()} version={0} />);
    await settled();
    expect(getMapMock).toHaveBeenCalledTimes(1);

    // A completion while the map is open bumps version → live refetch.
    rerender(<MapOverlay open onClose={vi.fn()} version={1} />);
    expect(getMapMock).toHaveBeenCalledTimes(2);

    // Close, then reopen → fresh fetch.
    rerender(<MapOverlay open={false} onClose={vi.fn()} version={1} />);
    expect(getMapMock).toHaveBeenCalledTimes(2);
    rerender(<MapOverlay open onClose={vi.fn()} version={1} />);
    expect(getMapMock).toHaveBeenCalledTimes(3);
  });
});
