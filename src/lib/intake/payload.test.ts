import { describe, expect, it } from "vitest";

import { draftLearnLoops } from "./atlas";
import {
  INTAKE_CONCEPT,
  buildIntakePayload,
  buildManualTaskPayload,
  parseGraphDrop,
} from "./payload";

describe("buildIntakePayload", () => {
  const stubs = draftLearnLoops("", "q3-brief.md");
  const payload = buildIntakePayload(stubs, "q3-brief.md", 0);

  it("is a version-1 graph with no seeded ledger", () => {
    expect(payload.version).toBe(1);
    expect(payload.seed_learned).toEqual([]);
  });

  it("creates the in{N+1} custom INBOX project", () => {
    expect(payload.projects).toEqual([
      { key: "in1", name: "INBOX — Q3-BRIEF", full_name: "inbox", custom: true },
    ]);
    expect(buildIntakePayload(stubs, "q3-brief.md", 2).projects[0]?.key).toBe("in3");
  });

  it("truncates the lane name at 30 characters", () => {
    const long = buildIntakePayload(stubs, "a very long document name indeed.md", 0);
    const name = long.projects[0]?.name ?? "";
    expect(name).toBe("INBOX — A VERY LONG DOCUMENT N");
    expect(name).toHaveLength(30);
  });

  it("ships the intake concept (the learn loops' FK target)", () => {
    expect(payload.concepts).toEqual([
      { id: "intake", name: "intake learn-loops", resurface_hint: "~4d" },
    ]);
  });

  it("chains ids, deps, pr, and frees", () => {
    expect(payload.tasks.map((task) => task.id)).toEqual(["in1-1", "in1-2", "in1-3"]);
    expect(payload.tasks.map((task) => task.deps)).toEqual([[], ["in1-1"], ["in1-2"]]);
    expect(payload.tasks.map((task) => task.pr)).toEqual([1, 2, 3]);
    expect(payload.tasks.map((task) => task.frees)).toEqual(["frees in1-2", "frees in1-3", ""]);
  });

  it("carries the stub fields plus the fixed import copy", () => {
    const [first] = payload.tasks;
    expect(first?.title).toBe("Skim q3-brief.md");
    expect(first?.short).toBe("Skim q3-brief.md");
    expect(first?.owner).toBe("you");
    expect(first?.kind).toBe("action");
    expect(first?.in_progress).toBe(false);
    expect(first?.sub).toBe("imported — refine as you go");
    expect(payload.tasks.map((task) => task.effort_min)).toEqual([5, 10, 15]);
  });

  it("stamps the placeholder learn loop on every task", () => {
    for (const task of payload.tasks) {
      expect(task.learn?.before).toBe(
        "Imported from q3-brief.md. Atlas drafts the full learn-loop from the source; this shell is ready to run now.",
      );
      expect(task.learn?.steps).toEqual([
        {
          idx: 0,
          text: "Open q3-brief.md and confirm the scope",
          cmd: null,
          concept_label: null,
          concept_text: null,
        },
        {
          idx: 1,
          text: "Do it — notes land back on this card",
          cmd: null,
          concept_label: null,
          concept_text: null,
        },
      ]);
      expect(task.learn?.decision_options).toEqual([]);
    }
  });

  it("uses the prototype's intakeCap word-for-word", () => {
    expect(payload.tasks[0]?.learn?.capture).toEqual({
      concept_id: "intake",
      question: "Who writes the learn-loop for imported tasks?",
      choices: [
        "You, by hand, before starting",
        "Atlas drafts it from the source doc; you skim and go",
        "It must be written in the original document",
        "Imported tasks don’t get one",
      ],
      correct_index: 1,
      why: "Intake is the mouth; Atlas chews. You only skim.",
    });
  });
});

describe("buildManualTaskPayload", () => {
  const payload = buildManualTaskPayload({
    projectKey: "ds",
    title: "Chase the DNS ticket",
    kind: "provide",
    effortMin: 30,
    deps: ["ds1", "ds2"],
    nonce: "abc",
  });

  it("appends one task to the existing project without re-shipping it", () => {
    expect(payload.version).toBe(1);
    expect(payload.projects).toEqual([]);
    expect(payload.concepts).toEqual([INTAKE_CONCEPT]);
    expect(payload.seed_learned).toEqual([]);
    expect(payload.tasks).toHaveLength(1);
    const [task] = payload.tasks;
    expect(task?.id).toBe("ds-mabc");
    expect(task?.project).toBe("ds");
    expect(task?.pr).toBe(999);
    expect(task?.kind).toBe("provide");
    expect(task?.effort_min).toBe(30);
    expect(task?.deps).toEqual(["ds1", "ds2"]);
    expect(task?.frees).toBe("");
  });

  it("still carries a runnable placeholder learn loop", () => {
    const learn = payload.tasks[0]?.learn;
    expect(learn?.capture.concept_id).toBe("intake");
    expect(learn?.steps).toHaveLength(2);
  });
});

describe("parseGraphDrop", () => {
  const graph = JSON.stringify({
    version: 1,
    projects: [{ key: "zz", name: "Z", full_name: "z", custom: true }],
    concepts: [],
    tasks: [{ id: "zz-1" }, { id: "zz-2" }],
    seed_learned: [],
  });

  it("recognizes a dropped graph payload", () => {
    expect(parseGraphDrop("graph.json", graph)).toEqual({
      raw: graph,
      taskCount: 2,
      firstProjectKey: "zz",
    });
  });

  it("tolerates a payload without projects", () => {
    const bare = JSON.stringify({ version: 1, tasks: [] });
    expect(parseGraphDrop("bare.json", bare)).toEqual({
      raw: bare,
      taskCount: 0,
      firstProjectKey: null,
    });
  });

  it("rejects non-.json names, invalid JSON, and non-graph JSON", () => {
    expect(parseGraphDrop("graph.md", graph)).toBeNull();
    expect(parseGraphDrop("broken.json", "{nope")).toBeNull();
    expect(parseGraphDrop("other.json", JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseGraphDrop("other.json", JSON.stringify(["nope"]))).toBeNull();
  });
});
