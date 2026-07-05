# The resurfacing scheduler

How Slipway decides when a concept comes back. Implemented as pure functions
in [`crates/slipway-core/src/derive.rs`](../crates/slipway-core/src/derive.rs)
(`concept_state`, `correct_interval_days`, `due_at`, `next_display`), driven
by the append-only `capture_event` history described in
[data-model.md](data-model.md). Nothing is scheduled ahead of time: due-ness
is recomputed from the event log on every ask.

## Events and state

Every graded interaction appends one event: `correct`, `miss`, or `hollow`
(the capture was skipped). Events with a `task_id` came from completing a task
(a **capture**); events without one came from answering a **recheck**.

Folding a concept's events chronologically gives its state:

- `latest` — the most recent result.
- `streak` — trailing consecutive `correct` count. A miss or hollow resets it
  to 0.
- `last_at` — timestamp of the latest event.

## Intervals

The concept is due at `last_at + interval`, where the interval depends on
`latest`:

| Latest result | Due                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `correct`     | `4d × 2^(streak−1)`, capped at 30d: streak 1 → 4d, 2 → 8d, 3 → 16d, ≥4 → 30d                   |
| `miss`        | 1d — a miss pulls the concept back tomorrow                                                    |
| `hollow`      | due **now** — a skipped capture is offered immediately, and keeps being offered until answered |

## Resurface hints

Authors can put a `resurface_hint` on a concept. Two shapes:

- **Pure hints** (`~4d`, `30d`) are display-only. The computed interval always
  governs the actual schedule; the hint is just the author's phrasing of it.
- **Task-riding hints** (`with ds5`, `at ds7` — `with`/`at` followed by a
  task id) tie the concept to a task. While that task is still open, the
  concept is **never clock-due** (`due_at = None`): it will resurface in
  passing when the rider task is done. Once the task closes, the hint expires
  and the computed interval takes over. Exception: a `hollow` latest result is
  due now even while the rider task is open.

## What the ledger shows (`next_display`)

The "next" column follows the schedule, with one display rule on top: the
author's pure hint shows **only while the latest event is a capture**. Once
the scheduler owns the concept — i.e. after any recheck answer — the display
switches to the computed interval, so what the row says always agrees with
when the recheck will actually fire.

| Latest result | Hint                      | Shows                                  |
| ------------- | ------------------------- | -------------------------------------- |
| `hollow`      | any                       | `skipped — ask anytime`                |
| `miss`        | any                       | `~1d — missed`                         |
| `correct`     | task-riding, task open    | the hint (`with ds5`) — it governs too |
| `correct`     | pure, latest is a capture | the hint (`~4d`)                       |
| `correct`     | otherwise                 | the computed interval (`4d`, `8d`, …)  |

## Rechecks in passing

- `due_recheck` returns the **single most-overdue** due concept, or nothing.
  The footer offers it (`[r] 20s recheck — …`) only when the app is otherwise
  quiet — no toast, drawer, overlay, or open quiz.
- The quiz question is the concept's bespoke `recheck_question` when one
  exists, otherwise the capture question of the most recent task that fed the
  concept.
- Answering appends a `correct`/`miss` event (with `task_id` NULL) and the
  cycle continues: right extends the streak and doubles the interval, wrong
  comes back in a day.
- The ledger's "ask me" asks any concept on demand, due or not — graded the
  same way.

## Seeded history

`seed_learned` import entries fabricate a plausible past: `streak` synthetic
`correct` events spaced a day apart, the last one backdated 31 days (just past
the 30d cap), plus an optional trailing `hollow`. Net effect: seeded concepts
are due for a recheck on first run, which is how the launch graph demos the
loop immediately.
