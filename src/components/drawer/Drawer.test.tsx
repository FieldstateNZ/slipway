import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTaskDetail } from "../../lib/ipc/commands";
import type { TaskDetail } from "../../lib/ipc/types";
import { KEY_PRIORITY, registerKeyLayer } from "../../lib/keys";
import { Drawer, type DrawerParkSnapshot } from "./Drawer";

vi.mock("../../lib/ipc/commands", () => ({
  getTaskDetail: vi.fn(),
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

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.mocked(getTaskDetail).mockReset();
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

/** Settle the getTaskDetail promise chain (also under fake timers). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface RenderOptions {
  restored?: DrawerParkSnapshot | null;
  onCapturePhase?: (detail: TaskDetail, decisionChoice: number | null) => void;
}

async function renderDrawer(detail: TaskDetail, options: RenderOptions = {}) {
  vi.mocked(getTaskDetail).mockResolvedValue(detail);
  const onPark = vi.fn();
  const utils = render(
    <Drawer
      taskId={detail.id}
      restored={options.restored ?? null}
      onPark={onPark}
      onCapturePhase={options.onCapturePhase}
    />,
  );
  await flushMicrotasks();
  return { onPark, ...utils };
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

  it("Enter advances through the steps, switches the button label, and lands in the capture placeholder", async () => {
    const onCapturePhase = vi.fn();
    await renderDrawer(ds3Detail, { onCapturePhase });
    expect(screen.getByText("Done — next step ↵")).toBeInTheDocument();

    key("Enter");
    expect(screen.getByText("STEP 2 OF 3")).toBeInTheDocument();
    expect(screen.getByText("Done — next step ↵")).toBeInTheDocument();

    key("Enter");
    expect(screen.getByText("STEP 3 OF 3")).toBeInTheDocument();
    expect(screen.getByText("Done — one question ↵")).toBeInTheDocument();

    key("Enter");
    // Capture placeholder: the faded ✓ ledger of the completed steps.
    expect(screen.getByText("✓ Add the record at your registrar")).toBeInTheDocument();
    expect(screen.getByText("✓ Wait out propagation — minutes to an hour")).toBeInTheDocument();
    expect(screen.getByText("✓ Confirm it resolves")).toBeInTheDocument();
    expect(screen.queryByText(/STEP \d OF/)).not.toBeInTheDocument();
    expect(onCapturePhase).toHaveBeenCalledExactlyOnceWith(ds3Detail, null);
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

  it("Esc still parks from the capture placeholder", async () => {
    const { onPark } = await renderDrawer(ds3Detail, {
      restored: { phase: "capture", stepIdx: 2, decisionChoice: null },
    });
    expect(screen.getByText("✓ Confirm it resolves")).toBeInTheDocument();
    key("Escape");
    expect(onPark).toHaveBeenCalledExactlyOnceWith({
      phase: "capture",
      stepIdx: 2,
      decisionChoice: null,
    });
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

  it("key 2 records the choice and lands in the capture placeholder", async () => {
    const onCapturePhase = vi.fn();
    await renderDrawer(ds9Detail, { onCapturePhase });
    key("2");
    expect(
      screen.getByText("✓ call made — Keep workspec.fieldstate.io/v1alpha1"),
    ).toBeInTheDocument();
    expect(screen.queryByText("THE CALL — PICK ONE")).not.toBeInTheDocument();
    expect(onCapturePhase).toHaveBeenCalledExactlyOnceWith(ds9Detail, 1);
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
});
