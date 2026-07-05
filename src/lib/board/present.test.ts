import { describe, expect, it } from "vitest";

import type { FocusCard, LaneView } from "../ipc/types";
import {
  WAIT_TITLE,
  advLabel,
  buttonLabel,
  displayedFocus,
  focusMeta,
  laneNameColor,
  queueLength,
  queueWhisper,
  readySummary,
  waitSub,
} from "./present";

function card(id: string, over: Partial<FocusCard> = {}): FocusCard {
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

function lane(over: Partial<LaneView> = {}): LaneView {
  const focus = "focus" in over ? (over.focus ?? null) : card("ds1");
  return {
    key: "ds",
    name: "DECISION STUDIO",
    full_name: "decision-studio",
    custom: false,
    focus,
    queue: focus !== null ? [focus] : [],
    others_behind: 0,
    remaining_effort_min: 0,
    ...over,
  };
}

describe("laneNameColor", () => {
  it("reads secondary when active", () => {
    expect(laneNameColor(true)).toBe("var(--sw-text-secondary)");
  });

  it("reads muted otherwise", () => {
    expect(laneNameColor(false)).toBe("var(--sw-text-muted)");
  });
});

describe("advLabel", () => {
  it("shows advancing… while the lane advances", () => {
    expect(advLabel(true)).toBe("advancing…");
  });

  it("is empty otherwise", () => {
    expect(advLabel(false)).toBe("");
  });
});

describe("queueWhisper", () => {
  it("hides while advancing", () => {
    expect(queueWhisper(lane({ others_behind: 3, remaining_effort_min: 20 }), true)).toBe("");
  });

  it("sw lane with focus whispers the ownership relay", () => {
    expect(queueWhisper(lane({ key: "sw" }), false)).toBe("then atlas → pipeline → you");
  });

  it("sw lane without focus whispers nothing", () => {
    expect(queueWhisper(lane({ key: "sw", focus: null }), false)).toBe("");
  });

  it.each([
    [
      "N behind, stock lane",
      lane({ others_behind: 2, remaining_effort_min: 25 }),
      "2 behind · ≈25m to launch",
    ],
    [
      "N behind, custom lane",
      lane({ custom: true, key: "in1", others_behind: 2, remaining_effort_min: 25 }),
      "2 behind · ≈25m — imported",
    ],
    [
      "remaining only, stock lane",
      lane({ others_behind: 0, remaining_effort_min: 12 }),
      "≈12m to launch",
    ],
    [
      "remaining only, custom lane",
      lane({ custom: true, key: "in1", others_behind: 0, remaining_effort_min: 12 }),
      "≈12m — imported",
    ],
    [
      "nothing left of yours",
      lane({ focus: null, others_behind: 0, remaining_effort_min: 0 }),
      "yours done — others finishing",
    ],
  ])("%s", (_name, laneView, expected) => {
    expect(queueWhisper(laneView, false)).toBe(expected);
  });
});

describe("focusMeta", () => {
  it("marks in-progress work in accent", () => {
    expect(focusMeta(card("sw1", { in_progress: true }))).toEqual({
      text: "● in progress — this session",
      accent: true,
    });
  });

  it.each([
    ["action with effort", card("ds1", { effort_min: 5 }), "next · 5m"],
    ["ongoing action", card("sw1", { effort_min: 0 }), "next · ongoing"],
    ["decision", card("ds4", { kind: "decision", effort_min: 10 }), "next · 10m · decision"],
    ["provide", card("lm2", { kind: "provide", effort_min: 3 }), "next · 3m · provide"],
  ])("%s", (_name, focus, expected) => {
    expect(focusMeta(focus)).toEqual({ text: expected, accent: false });
  });
});

describe("buttonLabel", () => {
  it.each([
    [
      "in progress wins over kind",
      card("sw1", { in_progress: true, kind: "decision" }),
      "Continue ↵",
    ],
    ["decision", card("ds4", { kind: "decision" }), "Decide ↵"],
    ["provide", card("lm2", { kind: "provide" }), "Hand over ↵"],
    ["action", card("ds1"), "Start ↵"],
  ])("%s", (_name, focus, expected) => {
    expect(buttonLabel(focus)).toBe(expected);
  });
});

describe("waiting copy", () => {
  it("uses the shared title", () => {
    expect(WAIT_TITLE).toBe("Nothing needs you here");
  });

  it.each([
    ["ds", lane({ key: "ds" }), "▸ ▸ ▸  atlas is finishing — marketing copy"],
    ["lm", lane({ key: "lm" }), "▸ ▸ ▸  pipeline carries it — staging + harness next"],
    ["sw", lane({ key: "sw" }), "▸ ▸ ▸  atlas takes it — spec + backlog"],
    ["custom", lane({ key: "in1", custom: true }), "▸ ▸ ▸  all done — archive it"],
  ])("%s", (_name, laneView, expected) => {
    expect(waitSub(laneView)).toBe(expected);
  });
});

describe("readySummary", () => {
  it("formats count and effort", () => {
    expect(readySummary({ lanes: [], ready_count: 4, ready_effort_min: 35 })).toBe("4 ready · 35m");
  });
});

describe("queueLength / displayedFocus", () => {
  const queued = lane({ queue: [card("ds1"), card("ds2"), card("ds4")] });

  it("counts the lane queue", () => {
    expect(queueLength(queued)).toBe(3);
    expect(queueLength(lane({ focus: null }))).toBe(0);
  });

  it("cycles the deal offset through the queue, wrapping", () => {
    expect(displayedFocus(queued, 0)?.id).toBe("ds1");
    expect(displayedFocus(queued, 1)?.id).toBe("ds2");
    expect(displayedFocus(queued, 2)?.id).toBe("ds4");
    expect(displayedFocus(queued, 3)?.id).toBe("ds1");
  });

  it("returns null for an empty queue", () => {
    expect(displayedFocus(lane({ focus: null }), 0)).toBeNull();
  });
});
