// Extracts the seed task graph from the authoritative design prototype
// (docs/design/project/Slipway Sidebar.dc.html) into seed/launch-graph.json.
// Run: node scripts/extract-seed.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "docs/design/project/Slipway Sidebar.dc.html"), "utf8");

function block(name) {
  const start = html.indexOf(`${name} = `);
  if (start < 0) throw new Error(`${name} not found`);
  const end = html.indexOf(";\n", start);
  return html.slice(start + name.length + 3, end);
}

const ctx = {};
vm.createContext(ctx);
const TASKS = vm.runInContext(`(${block("TASKS")})`, ctx);
const RESURF = vm.runInContext(`(${block("RESURF")})`, ctx);
const CNAMES = vm.runInContext(`(${block("CNAMES")})`, ctx);
const PROJ = vm.runInContext(`(${block("PROJ")})`, ctx);
const PROJFULL = vm.runInContext(`(${block("PROJFULL")})`, ctx);

// The prototype's seedLearned(): the ttl concept arrives pre-held (streak 4,
// from ds3) with its own recheck question — it drives the first-run recheck slot.
const seedLearnedSrc = html.match(/return \{ ttl: (\{.*?\}) \};/s);
if (!seedLearnedSrc) throw new Error("seedLearned not found");
const ttl = vm.runInContext(`(${seedLearnedSrc[1]})`, ctx);

const projects = Object.keys(PROJ).map((key) => ({
  key,
  name: PROJ[key],
  full_name: PROJFULL[key],
  custom: false,
}));

const concepts = Object.keys(CNAMES).map((id) => ({
  id,
  name: CNAMES[id],
  resurface_hint: RESURF[id] ?? null,
}));

const tasks = TASKS.map((t) => ({
  id: t.id,
  project: t.proj,
  pr: t.pr,
  owner: t.owner,
  kind: t.kind,
  effort_min: t.eff,
  deps: t.deps,
  title: t.title,
  short: t.short,
  sub: t.sub,
  frees: t.frees,
  in_progress: !!t.inprog,
  learn: t.learn
    ? {
        before: t.learn.before,
        steps: (t.learn.steps ?? []).map((s, idx) => ({
          idx,
          text: s.t,
          cmd: s.cmd ?? null,
          concept_label: s.concept?.label ?? null,
          concept_text: s.concept?.text ?? null,
        })),
        decision_options: (t.learn.dec ?? []).map((o, idx) => ({
          idx,
          title: o.title,
          body: o.body,
        })),
        capture: {
          concept_id: t.learn.cap.cid,
          question: t.learn.cap.q,
          choices: t.learn.cap.choices,
          correct_index: t.learn.cap.correct,
          why: t.learn.cap.why,
        },
      }
    : null,
}));

const seed = {
  version: 1,
  projects,
  concepts,
  tasks,
  // Pre-seeded ledger state from the prototype: consecutive correct captures
  // reproduce the streak; the question powers "ask me" / the first-run recheck.
  seed_learned: [
    {
      concept_id: ttl.cid,
      from_task: ttl.from,
      streak: ttl.streak,
      hollow: ttl.hollow,
      next: ttl.next,
      question: {
        question: ttl.q.q,
        choices: ttl.q.choices,
        correct_index: ttl.q.correct,
        why: ttl.q.why,
      },
    },
  ],
};

mkdirSync(join(root, "seed"), { recursive: true });
writeFileSync(join(root, "seed/launch-graph.json"), JSON.stringify(seed, null, 2) + "\n");
console.log(
  `wrote seed/launch-graph.json: ${projects.length} projects, ${tasks.length} tasks, ${concepts.length} concepts`,
);
