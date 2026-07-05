import { describe, expect, it } from "vitest";

import { baseName, draftLearnLoops } from "./atlas";

describe("baseName", () => {
  it("strips a trailing extension", () => {
    expect(baseName("q3-brief.md")).toBe("q3-brief");
    expect(baseName("notes.TXT")).toBe("notes");
  });

  it("leaves extensionless names alone", () => {
    expect(baseName("pasted text")).toBe("pasted text");
  });

  it("strips only the last extension", () => {
    expect(baseName("launch.plan.json")).toBe("launch.plan");
  });
});

describe("draftLearnLoops (v0.1 deterministic Atlas)", () => {
  it("drafts the prototype's three stubs from the source name", () => {
    expect(draftLearnLoops("whatever", "q3-brief.md")).toEqual([
      { title: "Skim q3-brief.md", kind: "action", effortMin: 5 },
      { title: "Extract the decisions from q3-brief", kind: "action", effortMin: 10 },
      { title: "First concrete action out of q3-brief", kind: "action", effortMin: 15 },
    ]);
  });

  it("ignores the source text for now (the seam still carries it)", () => {
    expect(draftLearnLoops("a", "doc.md")).toEqual(
      draftLearnLoops("completely different", "doc.md"),
    );
  });
});
