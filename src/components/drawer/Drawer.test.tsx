import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completeTask, getTaskDetail } from "../../lib/ipc/commands";
import type { CompleteResult, TaskDetail } from "../../lib/ipc/types";
import { KEY_PRIORITY, registerKeyLayer } from "../../lib/keys";
import { SETTINGS_STORAGE_KEY, SettingsProvider } from "../../lib/settings";
import { Drawer, type DrawerParkSnapshot } from "./Drawer";

vi.mock("../../lib/ipc/commands", () => ({
  getTaskDetail: vi.fn(),
  completeTask: vi.fn(),
}));

// ds3 from seed/launch-graph.json — 3 steps: cmd+concept, concept, cmd.
const ds3Detail: TaskDetail = {
  id: "ds3",
  kind: "action",
  effort_min: 10,
  title: "Add DNS CNAME — schema.workspec.io → fieldstatenz.github.io",
  sub: "The schema’s permanent public address.",
  frees: "frees ds4 → ds6",
  project_full_name: "decision-studio",
  before:
    "A CNAME says “this name is an alias for that name.” You’re telling DNS that schema.workspec.io answers wherever GitHub Pages answers. Once GitHub sees the record it provisions a TLS certificate on its own.",
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
    choices: [
      "CNAMEs are faster to resolve",
      "GitHub’s IPs can change; the alias follows them, a hardcoded IP wouldn’t",
      "A records don’t support HTTPS",
      "Subdomains can’t have A records",
    ],
    correct_index: 1,
    why: "HTTPS comes from the certificate, not the record type — the alias is about GitHub’s changing IPs.",
  },
};

// ds9 from seed/launch-graph.json — a decision with 2 options.
const ds9Detail: TaskDetail = {
  id: "ds9",
  kind: "decision",
  effort_min: 5,
  title: "Decide: rename API_VERSION to match the new domain?",
  sub: "Breaking to every artifact — decide before adoption.",
  frees: "ungates ds7",
  project_full_name: "decision-studio",
  before:
    "The string workspec.fieldstate.io/v1alpha1 is stamped into every artifact. Today a rename costs one regeneration; after the first outside adopter it costs them, forever.",
  steps: [],
  decision_options: [
    {
      title: "Rename now → schema.workspec.io/v1alpha1",
      body: "Breaking today, clean forever. Every internal artifact regenerates once.",
    },
    {
      title: "Keep workspec.fieldstate.io/v1alpha1",
      body: "No churn now; the domain mismatch becomes permanent lore.",
    },
  ],
  capture: {
    question: "Why does this decision expire at the first outside adopter?",
    choices: [
      "npm locks the name at first publish",
      "After adoption the string is a public contract — changing it breaks them",
      "GitHub caches API_VERSION for 30 days",
      "SemVer forbids renames after 1.0",
    ],
    correct_index: 1,
    why: "Before adoption a rename is free; after, it’s someone else’s breakage.",
  },
};

const ds3Result: CompleteResult = {
  task_id: "ds3",
  capture: {
    concept_id: "dns",
    name: "dns aliasing",
    streak: 1,
    hollow: false,
    next_display: "with ds6",
  },
};

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getTaskDetail).mockReset();
  vi.mocked(completeTask).mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Settle the getTaskDetail/completeTask promise chains (also under fake timers). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface RenderOptions {
  restored?: DrawerParkSnapshot | null;
}

async function renderDrawer(detail: TaskDetail, options: RenderOptions = {}) {
  vi.mocked(getTaskDetail).mockResolvedValue(detail);
  const onPark = vi.fn();
  const onComplete = vi.fn();
  const utils = render(
    <SettingsProvider>
      <Drawer
        taskId={detail.id}
        restored={options.restored ?? null}
        onPark={onPark}
        onComplete={onComplete}
      />
    </SettingsProvider>,
  );
  await flushMicrotasks();
  return { onPark, onComplete, ...utils };
}

/** Straight into the capture phase, as a park-restore would land there. */
async function renderCapture(detail: TaskDetail = ds3Detail) {
  return renderDrawer(detail, {
    restored: { phase: "capture", stepIdx: detail.steps.length, decisionChoice: null },
  });
}

function key(k: string) {
  fireEvent.keyDown(document, { key: k });
}

describe("Drawer — steps phase", () => {
  it("renders crumb, park affordance, title, sub + frees, and the BEFORE card", async () => {
    await renderDrawer(ds3Detail);
    expect(getTaskDetail).toHaveBeenCalledWith("ds3");
    expect(screen.getByText("decision-studio · ds3 · 10m")).toBeInTheDocument();
    expect(screen.getByText("esc parks it ✕")).toBeInTheDocument();
    expect(
      screen.getByText("Add DNS CNAME — schema.workspec.io → fieldstatenz.github.io"),
    ).toBeInTheDocument();
    expect(screen.getByText("frees ds4 → ds6")).toBeInTheDocument();
    expect(screen.getByText("BEFORE — 20 SECONDS")).toBeInTheDocument();
    expect(screen.getByText(ds3Detail.before)).toBeInTheDocument();
  });

  it("hides the effort segment of the crumb when effort_min is 0", async () => {
    await renderDrawer({ ...ds3Detail, effort_min: 0 });
    expect(screen.getByText("decision-studio · ds3")).toBeInTheDocument();
    expect(screen.queryByText(/· 10m/)).not.toBeInTheDocument();
  });

  it("shows the step count, remaining-step opacity/indent scheme, and the horizon pill", async () => {
    const { container } = await renderDrawer(ds3Detail);
    expect(screen.getByText("STEP 1 OF 3")).toBeInTheDocument();
    expect(screen.getByText("Add the record at your registrar")).toBeInTheDocument();

    const remaining = container.querySelectorAll<HTMLElement>(".sw-drawer-rem");
    expect(remaining).toHaveLength(2);
    expect(remaining[0]?.textContent).toContain("then");
    expect(remaining[0]?.textContent).toContain("Wait out propagation — minutes to an hour");
    expect(remaining[0]?.style.opacity).toBe("0.6");
    expect(remaining[0]?.style.marginLeft).toBe("12px");
    expect(remaining[1]?.textContent).toContain("Confirm it resolves");
    expect(remaining[1]?.style.opacity).toBe("0.4");
    expect(remaining[1]?.style.marginLeft).toBe("24px");

    expect(screen.getByText("⚑ then one question ◌→●")).toBeInTheDocument();
  });

  it("copies the exact cmd and flips the label back after 1.4s", async () => {
    vi.useFakeTimers();
    const { container } = await renderDrawer(ds3Detail);
    // Exact text, double spaces included (RTL's normalizer would collapse them).
    expect(container.querySelector(".sw-drawer-cmd-text")?.textContent).toBe(
      "schema.workspec.io  CNAME  fieldstatenz.github.io",
    );

    fireEvent.click(screen.getByRole("button", { name: "⧉ copy" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "schema.workspec.io  CNAME  fieldstatenz.github.io",
    );
    expect(screen.getByRole("button", { name: "⧉ copied" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1399);
    });
    expect(screen.getByRole("button", { name: "⧉ copied" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("button", { name: "⧉ copy" })).toBeInTheDocument();
  });

  it("still flips the copy label when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await renderDrawer(ds3Detail);
    fireEvent.click(screen.getByRole("button", { name: "⧉ copy" }));
    expect(screen.getByRole("button", { name: "⧉ copied" })).toBeInTheDocument();
  });

  it("keeps the concept disclosure strictly opt-in: closed on mount, toggles, closed after advance", async () => {
    await renderDrawer(ds3Detail);
    const step1Concept = ds3Detail.steps[0]?.concept_text ?? "";
    expect(screen.getByText("▸ why alias a name, not an IP — 10s")).toBeInTheDocument();
    expect(screen.queryByText(step1Concept)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("▸ why alias a name, not an IP — 10s"));
    expect(screen.getByText(step1Concept)).toBeInTheDocument();
    expect(screen.getByText("▴ tuck away")).toBeInTheDocument();

    fireEvent.click(screen.getByText("▴ tuck away"));
    expect(screen.queryByText(step1Concept)).not.toBeInTheDocument();

    // Open it again, then advance: the next step's disclosure must be closed.
    fireEvent.click(screen.getByText("▸ why alias a name, not an IP — 10s"));
    key("Enter");
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
    expect(screen.getByText("▸ what propagation actually is — 10s")).toBeInTheDocument();
    expect(screen.queryByText(ds3Detail.steps[1]?.concept_text ?? "")).not.toBeInTheDocument();
    expect(screen.queryByText("▴ tuck away")).not.toBeInTheDocument();
  });

  it("Enter advances through the steps, switches the button label, and lands in the capture pane", async () => {
    await renderDrawer(ds3Detail);
    expect(screen.getByText("Done — next step ↵")).toBeInTheDocument();

    key("Enter");
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
    expect(screen.getByText("Done — next step ↵")).toBeInTheDocument();

    key("Enter");
    expect(screen.getByText("STEP 3 OF 3")).toBeInTheDocument();
    expect(screen.getByText("Done — one question ↵")).toBeInTheDocument();

    key("Enter");
    // Capture pane: the faded ✓ ledger of the completed steps + ONE TAP.
    expect(screen.getByText("✓ Add the record at your registrar")).toBeInTheDocument();
    expect(screen.getByText("✓ Wait out propagation — minutes to an hour")).toBeInTheDocument();
    expect(screen.getByText("✓ Confirm it resolves")).toBeInTheDocument();
    expect(screen.queryByText(/STEP \d OF/)).not.toBeInTheDocument();
    expect(screen.getByText("ONE TAP.")).toBeInTheDocument();
    expect(screen.getByText("Why a CNAME here — not an A record?")).toBeInTheDocument();
  });

  it("clicking the primary button advances like Enter", async () => {
    await renderDrawer(ds3Detail);
    fireEvent.click(screen.getByRole("button", { name: "Done — next step ↵" }));
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
  });

  it("Esc parks with the current phase + step index, without completing", async () => {
    const { onPark } = await renderDrawer(ds3Detail);
    key("Enter");
    key("Escape");
    expect(onPark).toHaveBeenCalledExactlyOnceWith({
      phase: "steps",
      stepIdx: 1,
      decisionChoice: null,
    });
    expect(completeTask).not.toHaveBeenCalled();
  });

  it('the "esc parks it ✕" affordance parks too', async () => {
    const { onPark } = await renderDrawer(ds3Detail);
    fireEvent.click(screen.getByText("esc parks it ✕"));
    expect(onPark).toHaveBeenCalledExactlyOnceWith({
      phase: "steps",
      stepIdx: 0,
      decisionChoice: null,
    });
  });

  it("a restored snapshot reopens at the parked step with the disclosure closed", async () => {
    await renderDrawer(ds3Detail, {
      restored: { phase: "steps", stepIdx: 1, decisionChoice: null },
    });
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
    expect(screen.queryByText(ds3Detail.steps[1]?.concept_text ?? "")).not.toBeInTheDocument();
  });

  it("consumes its own keys so lower layers never see them, and lets the rest fall through", async () => {
    const below = vi.fn().mockReturnValue(false);
    const unregister = registerKeyLayer(KEY_PRIORITY.BOARD, below);
    try {
      await renderDrawer(ds3Detail);
      key("Enter");
      key("Escape");
      expect(below).not.toHaveBeenCalled();
      key("x");
      expect(below).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
});

describe("Drawer — decision phase", () => {
  it("renders the call label, numbered options, and the footer line", async () => {
    await renderDrawer(ds9Detail);
    expect(screen.getByText("decision-studio · ds9 · 5m")).toBeInTheDocument();
    expect(screen.getByText("THE CALL — PICK ONE")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Rename now → schema.workspec.io/v1alpha1")).toBeInTheDocument();
    expect(
      screen.getByText("Breaking today, clean forever. Every internal artifact regenerates once."),
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Keep workspec.fieldstate.io/v1alpha1")).toBeInTheDocument();
    expect(screen.getByText("choosing completes the task — then one question")).toBeInTheDocument();
  });

  it("key 2 records the choice and lands in the capture pane", async () => {
    await renderDrawer(ds9Detail);
    key("2");
    expect(
      screen.getByText("✓ call made — Keep workspec.fieldstate.io/v1alpha1"),
    ).toBeInTheDocument();
    expect(screen.queryByText("THE CALL — PICK ONE")).not.toBeInTheDocument();
    expect(screen.getByText("ONE TAP.")).toBeInTheDocument();
    expect(
      screen.getByText("Why does this decision expire at the first outside adopter?"),
    ).toBeInTheDocument();
  });

  it("clicking an option records that choice", async () => {
    const { onPark } = await renderDrawer(ds9Detail);
    fireEvent.click(screen.getByText("Rename now → schema.workspec.io/v1alpha1"));
    expect(
      screen.getByText("✓ call made — Rename now → schema.workspec.io/v1alpha1"),
    ).toBeInTheDocument();
    key("Escape");
    expect(onPark).toHaveBeenCalledExactlyOnceWith({
      phase: "capture",
      stepIdx: 0,
      decisionChoice: 0,
    });
  });

  it("passes the decision choice through to complete_task", async () => {
    vi.mocked(completeTask).mockResolvedValue({
      task_id: "ds9",
      capture: {
        concept_id: "breaking",
        name: "breaking-change surface",
        streak: 1,
        hollow: false,
        next_display: "at ds7",
      },
    });
    await renderDrawer(ds9Detail);
    key("2"); // The call.
    key("2"); // The correct capture pick.
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds9", "correct", 1);
  });
});

describe("Drawer — capture phase", () => {
  it("renders the ONE TAP pane: label, question, numbered choices, idle footer line", async () => {
    const { container } = await renderCapture();
    expect(screen.getByText("ONE TAP.")).toBeInTheDocument();
    expect(screen.getByText("Why a CNAME here — not an A record?")).toBeInTheDocument();

    const choices = container.querySelectorAll(".sw-drawer-cap-choice");
    expect(choices).toHaveLength(4);
    ds3Detail.capture.choices.forEach((text, index) => {
      expect(choices[index]?.querySelector(".sw-drawer-cap-key")?.textContent).toBe(
        String(index + 1),
      );
      expect(choices[index]?.querySelector(".sw-drawer-cap-text")?.textContent).toBe(text);
      expect(choices[index]).toHaveClass("sw-drawer-cap-choice-idle");
    });

    // Footer line with the clickable, underlined skip span.
    expect(container.querySelector(".sw-drawer-cap-idle")?.textContent).toBe(
      "1–4 commit · s skip — stays hollow ◌ · misses return sooner",
    );
    expect(screen.getByRole("button", { name: "s skip — stays hollow ◌" })).toHaveClass(
      "sw-drawer-cap-skip",
    );
  });

  it("correct pick flips the row, fires complete_task immediately, stamps, and finishes at 900ms", async () => {
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { container, onComplete } = await renderCapture();

    key("2");
    // The IPC fires on the pick, not at the end of the dwell.
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds3", "correct");

    const choices = container.querySelectorAll(".sw-drawer-cap-choice");
    expect(choices[1]).toHaveClass("sw-drawer-cap-choice-correct");
    expect(choices[1]?.querySelector(".sw-drawer-cap-mark")?.textContent).toBe("✓");
    expect(choices[0]).not.toHaveClass("sw-drawer-cap-choice-idle");
    // The idle footer line is gone once resolved.
    expect(container.querySelector(".sw-drawer-cap-idle")).not.toBeInTheDocument();

    // The response's capture feeds the stamp.
    await flushMicrotasks();
    expect(screen.getByText("● dns aliasing — captured")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(899);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "correct");
  });

  it("finishes only after BOTH the dwell timer and the complete_task response", async () => {
    vi.useFakeTimers();
    let resolveComplete!: (result: CompleteResult) => void;
    vi.mocked(completeTask).mockReturnValue(
      new Promise<CompleteResult>((resolve) => {
        resolveComplete = resolve;
      }),
    );
    const { onComplete } = await renderCapture();

    key("2");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    // Timer done but the response is still in flight — do not finish yet.
    expect(onComplete).not.toHaveBeenCalled();

    resolveComplete(ds3Result);
    await flushMicrotasks();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "correct");
  });

  it("finishes a correct pick after 250ms under reducedMotion", async () => {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ reducedMotion: true, keyHints: true }),
    );
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { onComplete } = await renderCapture();

    key("2");
    await flushMicrotasks();
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "correct");
  });

  it("clicking a choice picks it like the number key", async () => {
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    await renderCapture();
    fireEvent.click(
      screen.getByText("GitHub’s IPs can change; the alias follows them, a hardcoded IP wouldn’t"),
    );
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds3", "correct");
  });

  it("a miss reveals ✕, the correct row, and the why — completing only on continue", async () => {
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { container, onComplete } = await renderCapture();

    key("1");
    // Nothing is written yet — the why is the win, read first.
    expect(completeTask).not.toHaveBeenCalled();

    const choices = container.querySelectorAll(".sw-drawer-cap-choice");
    expect(choices[0]).toHaveClass("sw-drawer-cap-choice-missed");
    expect(choices[0]?.querySelector(".sw-drawer-cap-mark")?.textContent).toBe("✕");
    expect(choices[1]).toHaveClass("sw-drawer-cap-choice-reveal");
    expect(choices[1]?.querySelector(".sw-drawer-cap-mark")?.textContent).toBe("→ this one");
    expect(screen.getByText(ds3Detail.capture.why)).toBeInTheDocument();
    expect(container.querySelector(".sw-drawer-cap-idle")).not.toBeInTheDocument();

    key("Enter");
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds3", "miss");
    await flushMicrotasks();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "miss");
  });

  it('clicking "Got it — continue ↵" finishes the miss too', async () => {
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { onComplete } = await renderCapture();
    key("3");
    fireEvent.click(screen.getByRole("button", { name: "Got it — continue ↵" }));
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds3", "miss");
    await flushMicrotasks();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "miss");
  });

  it("s skips — completes hollow immediately", async () => {
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { onComplete } = await renderCapture();
    key("s");
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds3", "hollow");
    await flushMicrotasks();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "hollow");
  });

  it("the underlined skip span skips on click", async () => {
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { onComplete } = await renderCapture();
    fireEvent.click(screen.getByRole("button", { name: "s skip — stays hollow ◌" }));
    expect(completeTask).toHaveBeenCalledExactlyOnceWith("ds3", "hollow");
    await flushMicrotasks();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(ds3Result, "hollow");
  });

  it("Esc parks from the idle capture pane, but does nothing once a pick landed", async () => {
    vi.useFakeTimers();
    vi.mocked(completeTask).mockResolvedValue(ds3Result);
    const { onPark } = await renderCapture();

    // Idle: Esc parks (existing behavior).
    key("Escape");
    expect(onPark).toHaveBeenCalledExactlyOnceWith({
      phase: "capture",
      stepIdx: 3,
      decisionChoice: null,
    });
    onPark.mockClear();

    // After a correct pick: capture keys only.
    key("2");
    key("Escape");
    expect(onPark).not.toHaveBeenCalled();
  });

  it("Esc does nothing during the miss reveal", async () => {
    const { onPark } = await renderCapture();
    key("1");
    key("Escape");
    expect(onPark).not.toHaveBeenCalled();
    expect(screen.getByText("Got it — continue ↵")).toBeInTheDocument();
  });

  it("a rejected complete_task keeps the drawer open with an inline error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.mocked(completeTask).mockRejectedValue(new Error("db locked"));
      const { onComplete } = await renderCapture();
      key("s");
      await flushMicrotasks();
      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByText("couldn’t complete — db locked")).toBeInTheDocument();
      expect(screen.getByText("ONE TAP.")).toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a failed correct pick re-opens the Esc exit", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.mocked(completeTask).mockRejectedValue(new Error("db locked"));
      const { onPark, onComplete } = await renderCapture();
      key("2");
      await flushMicrotasks();
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByText("couldn’t complete — db locked")).toBeInTheDocument();
      key("Escape");
      expect(onPark).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
