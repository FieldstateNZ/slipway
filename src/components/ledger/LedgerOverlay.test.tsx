import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLedger } from "../../lib/ipc/commands";
import type { LedgerRow } from "../../lib/ipc/types";
import { LedgerOverlay } from "./LedgerOverlay";

vi.mock("../../lib/ipc/commands", () => ({
  getLedger: vi.fn(),
}));

const getLedgerMock = vi.mocked(getLedger);

// Mirrors the prototype's mid-flight ledger: a held 4-streak, a fresh capture,
// a hollow skip (no question), and an uncapped streak that must clamp at 4.
function makeRows(): LedgerRow[] {
  return [
    {
      concept_id: "ttl",
      name: "cache ttl + propagation",
      from_task: "ds3",
      streak: 4,
      hollow: false,
      next_display: "30d",
      has_question: true,
    },
    {
      concept_id: "oidc",
      name: "oidc trusted publishing",
      from_task: "ds1",
      streak: 1,
      hollow: false,
      next_display: "with ds5",
      has_question: true,
    },
    {
      concept_id: "urls",
      name: "stable public urls",
      from_task: "ds2",
      streak: 0,
      hollow: true,
      next_display: "skipped — ask anytime",
      has_question: false,
    },
    {
      concept_id: "dns",
      name: "dns aliasing",
      from_task: "ds3",
      streak: 7,
      hollow: false,
      next_display: "30d",
      has_question: true,
    },
  ];
}

function renderLedger(over: Partial<Parameters<typeof LedgerOverlay>[0]> = {}) {
  getLedgerMock.mockResolvedValue(makeRows());
  const onClose = vi.fn();
  const onAsk = vi.fn();
  const utils = render(<LedgerOverlay open onClose={onClose} onAsk={onAsk} {...over} />);
  return { ...utils, onClose, onAsk };
}

async function settled() {
  await screen.findByText("cache ttl + propagation");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LedgerOverlay", () => {
  it("renders nothing (and fetches nothing) when closed", () => {
    getLedgerMock.mockResolvedValue(makeRows());
    const { container } = render(<LedgerOverlay open={false} onClose={vi.fn()} onAsk={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(getLedgerMock).not.toHaveBeenCalled();
  });

  it("shows the exact header, summary, tagline, and footer copy", async () => {
    renderLedger();
    await settled();
    expect(screen.getByText("Learned")).toHaveClass("sw-ledger-title");
    // 4 rows · 3 with streak>0 and not hollow · 1 hollow.
    expect(screen.getByText("4 · 3 held · 1 hollow ◌")).toHaveClass("sw-ledger-summary");
    expect(screen.getByText("esc ✕")).toHaveClass("sw-ledger-close");
    expect(
      screen.getByText("Evidence, not homework — rechecks ride along on the board."),
    ).toHaveClass("sw-ledger-tagline");
    expect(
      screen.getByText("hollow rings ◌ queue the same one-tap question — no quiz screens anywhere"),
    ).toHaveClass("sw-ledger-footer");
  });

  it("renders streak blocks filled to the display cap of 4", async () => {
    const { container } = renderLedger();
    await settled();
    const rows = container.querySelectorAll(".sw-ledger-row");
    expect(rows).toHaveLength(4);

    // Full streak: 4 filled, 0 empty.
    expect(rows[0]?.querySelector(".sw-ledger-streak-fill")?.textContent).toBe("▮▮▮▮");
    expect(rows[0]?.querySelector(".sw-ledger-streak-rest")?.textContent).toBe("");
    // Fresh capture: 1 filled, 3 empty.
    expect(rows[1]?.querySelector(".sw-ledger-streak-fill")?.textContent).toBe("▮");
    expect(rows[1]?.querySelector(".sw-ledger-streak-rest")?.textContent).toBe("▮▮▮");
    // Hollow: 0 filled, 4 empty.
    expect(rows[2]?.querySelector(".sw-ledger-streak-fill")?.textContent).toBe("");
    expect(rows[2]?.querySelector(".sw-ledger-streak-rest")?.textContent).toBe("▮▮▮▮");
    // Uncapped storage streak clamps to 4 blocks.
    expect(rows[3]?.querySelector(".sw-ledger-streak-fill")?.textContent).toBe("▮▮▮▮");
  });

  it("prefixes hollow rows with ◌ and dims the name", async () => {
    renderLedger();
    await settled();
    const hollow = screen.getByText("◌ stable public urls");
    expect(hollow).toHaveClass("sw-ledger-name", "sw-ledger-name-hollow");
    expect(screen.getByText("cache ttl + propagation")).not.toHaveClass("sw-ledger-name-hollow");
  });

  it("shows the from-task · next line per row", async () => {
    renderLedger();
    await settled();
    expect(screen.getByText("ds1 · with ds5")).toHaveClass("sw-ledger-from");
    expect(screen.getByText("ds2 · skipped — ask anytime")).toHaveClass("sw-ledger-from");
  });

  it('offers "ask me" only for rows with a question, wired to the concept id', async () => {
    const { onAsk } = renderLedger();
    await settled();
    const asks = screen.getAllByRole("button", { name: "ask me" });
    // The hollow skip has no question yet — 3 of 4 rows are askable.
    expect(asks).toHaveLength(3);
    fireEvent.click(asks[1] as Element);
    expect(onAsk).toHaveBeenCalledExactlyOnceWith("oidc");
  });

  it("closes on Escape and on l (prototype toggle), not on other keys", async () => {
    const { onClose } = renderLedger();
    await settled();
    fireEvent.keyDown(document, { key: "x" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "l" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not eat keys while closed", () => {
    getLedgerMock.mockResolvedValue(makeRows());
    const onClose = vi.fn();
    render(<LedgerOverlay open={false} onClose={onClose} onAsk={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "l" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the header esc ✕ is clicked", async () => {
    const { onClose } = renderLedger();
    await settled();
    fireEvent.click(screen.getByText("esc ✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refetches on every open and on version bumps while open", async () => {
    getLedgerMock.mockResolvedValue(makeRows());
    const { rerender } = render(
      <LedgerOverlay open onClose={vi.fn()} onAsk={vi.fn()} version={0} />,
    );
    await settled();
    expect(getLedgerMock).toHaveBeenCalledTimes(1);

    // A quiz answer while the ledger is open bumps version → live refetch.
    rerender(<LedgerOverlay open onClose={vi.fn()} onAsk={vi.fn()} version={1} />);
    expect(getLedgerMock).toHaveBeenCalledTimes(2);

    // Close, then reopen → fresh fetch.
    rerender(<LedgerOverlay open={false} onClose={vi.fn()} onAsk={vi.fn()} version={1} />);
    expect(getLedgerMock).toHaveBeenCalledTimes(2);
    rerender(<LedgerOverlay open onClose={vi.fn()} onAsk={vi.fn()} version={1} />);
    expect(getLedgerMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a fetch failure instead of silently painting stale rows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      getLedgerMock.mockRejectedValue(new Error("no db"));
      render(<LedgerOverlay open onClose={vi.fn()} onAsk={vi.fn()} />);
      expect(await screen.findByText("couldn’t load the ledger — no db")).toHaveClass(
        "sw-ledger-error",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
