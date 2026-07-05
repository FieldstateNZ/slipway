import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerRecheck } from "../../lib/ipc/commands";
import type { DueRecheck, RecheckOutcome } from "../../lib/ipc/types";
import { KEY_PRIORITY, registerKeyLayer } from "../../lib/keys";
import { RecheckCard, type QuizSource } from "./RecheckCard";

vi.mock("../../lib/ipc/commands", () => ({
  answerRecheck: vi.fn(),
}));

// The seeded ttl concept from the prototype.
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

const heldOutcome: RecheckOutcome = { correct: true, streak: 2, next_display: "8d" };
const missOutcome: RecheckOutcome = { correct: false, streak: 0, next_display: "~1d — missed" };

beforeEach(() => {
  vi.mocked(answerRecheck).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderCard(source: QuizSource = "recheck") {
  const onClose = vi.fn();
  const onAnswered = vi.fn();
  const utils = render(
    <RecheckCard recheck={ttlRecheck} source={source} onClose={onClose} onAnswered={onAnswered} />,
  );
  return { ...utils, onClose, onAnswered };
}

function key(k: string) {
  fireEvent.keyDown(document, { key: k });
}

describe("RecheckCard", () => {
  it("renders the in-passing label, question, compact choices, and later ✕", () => {
    const { container } = renderCard("recheck");
    expect(screen.getByText("20S RECHECK — IN PASSING")).toHaveClass("sw-recheck-label");
    expect(screen.getByText(ttlRecheck.question)).toHaveClass("sw-recheck-q");
    const choices = container.querySelectorAll(".sw-recheck-choice");
    expect(choices).toHaveLength(4);
    ttlRecheck.choices.forEach((text, index) => {
      expect(choices[index]?.querySelector(".sw-recheck-key")?.textContent).toBe(String(index + 1));
      expect(choices[index]?.querySelector(".sw-recheck-text")?.textContent).toBe(text);
      expect(choices[index]).toHaveClass("sw-recheck-choice-idle");
    });
    expect(screen.getByText("later ✕")).toHaveClass("sw-recheck-close");
  });

  it("labels a ledger-sourced quiz ASK ME — FROM THE LEDGER", () => {
    renderCard("ledger");
    expect(screen.getByText("ASK ME — FROM THE LEDGER")).toHaveClass("sw-recheck-label");
  });

  it("later ✕ closes without answering", () => {
    const { onClose } = renderCard();
    fireEvent.click(screen.getByText("later ✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(answerRecheck).not.toHaveBeenCalled();
  });

  it("a correct pick answers, shows the held line, and auto-dismisses after 1700ms", async () => {
    vi.useFakeTimers();
    vi.mocked(answerRecheck).mockResolvedValue(heldOutcome);
    const { container, onClose, onAnswered } = renderCard();

    key("2");
    expect(answerRecheck).toHaveBeenCalledExactlyOnceWith("ttl", 1);
    const choices = container.querySelectorAll(".sw-recheck-choice");
    expect(choices[1]).toHaveClass("sw-recheck-choice-hit");
    expect(choices[1]?.querySelector(".sw-recheck-mark")?.textContent).toBe("✓");

    await flushMicrotasks();
    expect(onAnswered).toHaveBeenCalledExactlyOnceWith(heldOutcome);
    expect(screen.getByText("● held — fades 8d")).toHaveClass(
      "sw-recheck-result",
      "sw-recheck-result-correct",
    );

    act(() => {
      vi.advanceTimersByTime(1699);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a miss marks ✕, points → at the correct row, and shows the why", async () => {
    vi.useFakeTimers();
    vi.mocked(answerRecheck).mockResolvedValue(missOutcome);
    const { container, onClose } = renderCard();

    key("3");
    expect(answerRecheck).toHaveBeenCalledExactlyOnceWith("ttl", 2);
    const choices = container.querySelectorAll(".sw-recheck-choice");
    expect(choices[2]).toHaveClass("sw-recheck-choice-missed");
    expect(choices[2]?.querySelector(".sw-recheck-mark")?.textContent).toBe("✕");
    expect(choices[1]).toHaveClass("sw-recheck-choice-hit");
    expect(choices[1]?.querySelector(".sw-recheck-mark")?.textContent).toBe("→");
    expect(screen.getByText(`✕ ${ttlRecheck.why}`)).toHaveClass("sw-recheck-result");
    expect(screen.getByText(`✕ ${ttlRecheck.why}`)).not.toHaveClass("sw-recheck-result-correct");

    await flushMicrotasks();
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores further picks once resolved", async () => {
    vi.useFakeTimers();
    vi.mocked(answerRecheck).mockResolvedValue(heldOutcome);
    renderCard();
    key("2");
    key("3");
    fireEvent.click(screen.getByText(ttlRecheck.choices[0] as string));
    expect(answerRecheck).toHaveBeenCalledTimes(1);
  });

  it("clicking a choice answers like the number key", () => {
    vi.mocked(answerRecheck).mockResolvedValue(heldOutcome);
    renderCard();
    fireEvent.click(
      screen.getByText("Caches expire sooner, so the switch lands in minutes, not hours"),
    );
    expect(answerRecheck).toHaveBeenCalledExactlyOnceWith("ttl", 1);
  });

  it("consumes keys ahead of an overlay beneath it — Esc closes the quiz only", () => {
    const below = vi.fn().mockReturnValue(false);
    const unregister = registerKeyLayer(KEY_PRIORITY.OVERLAY, below);
    try {
      vi.mocked(answerRecheck).mockResolvedValue(heldOutcome);
      const { onClose } = renderCard("ledger");
      key("Escape");
      expect(onClose).toHaveBeenCalledTimes(1);
      key("2");
      key("l");
      key("g");
      // No key reaches the layers under the quiz card (prototype handleKey).
      expect(below).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("stays put with an inline error when answer_recheck rejects", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.mocked(answerRecheck).mockRejectedValue(new Error("no db"));
      const { onClose, onAnswered } = renderCard();
      key("2");
      await flushMicrotasks();
      expect(screen.getByText("couldn’t record that — no db")).toHaveClass("sw-recheck-result");
      expect(onAnswered).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1700);
      });
      // The dismiss timer was cancelled — the card waits for the user.
      expect(onClose).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
