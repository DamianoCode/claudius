---
name: diagnose
description: Disciplined diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose", "zdiagnozuj", "debug this", or reports something broken, throwing, failing, hanging or slow — and the cause is not already obvious from the stack trace.
argument-hint: "[objaw]"
---

# Diagnose

A discipline for bugs whose cause is not already obvious. A one-line typo with a clear stack trace does not need this skill — fix it. Everything else does.

Skip a phase only with an explicit stated reason.

**Read the project overlay first.** `~/.claude/context/<repo-basename>/PROJECT.md` carries the verified commands, the building blocks for a feedback loop and the hazards that recur in this repository; `CONTEXT.md` beside it carries the domain language for hypotheses and test names. Neither is required — without them, resolve the same facts from the manifest and task-runner targets before building a loop, and never invent a command you have not run.

## Redact

This skill has you show commands, outputs and captured payloads. **Redact every secret first** — write `<REDACTED>` in its place. Build loops against env vars so credentials stay in the environment rather than in what you print. Captured requests carry auth headers and tenant tokens: quote only the lines that carry signal.

If the redacted output is not enough to diagnose, say so and ask.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. With a tight pass/fail signal that goes red on *this* bug, you will find the cause — bisection, hypothesis testing and instrumentation all just consume it. Without one, no amount of reading code will save you.

Spend disproportionate effort here. Be aggressive, be creative, refuse to give up.

### Ways to construct one, roughly in this order

Take the concrete invocation for each from the overlay's "Feedback-loop building blocks" when it exists; otherwise derive it from the repository.

1. **Failing test** at whatever seam reaches the bug — a single test file, run with the project's own runner.
2. **HTTP script** against the running service — one request, diffed against the expected response.
3. **Direct database query** when the symptom is data rather than response — the smallest query that shows the wrong row.
4. **Queue or job replay** — enqueue one job with a fixture payload and assert on the resulting rows or emitted events, rather than watching the whole queue.
5. **Replay a captured payload.** Save the real third-party request or webhook to disk and push it through the code path in isolation.
6. **Throwaway harness** — a single script that boots the one service with mocked dependencies and calls the suspect function once.
7. **Property / fuzz loop** for "sometimes wrong" — 1000 generated inputs, look for the failure mode.
8. **Bisection harness** — if it appeared between two known states, automate "boot at X, check, repeat" so `git bisect run` can drive it.
9. **Differential loop** — same input through two versions, tenants, environments or configs, diff the outputs.
10. **Browser script** for UI bugs, asserting on DOM, console or network.
11. **Human in the loop.** Last resort, when only a person can trigger it — script what they must do and what to paste back, so the loop stays structured.

**Before concluding "the code never runs", rule out the environment.** Feature flags, environment guards that disable side effects outside production, seeded-data assumptions and per-tenant configuration all produce a "nothing happened" symptom that looks exactly like a bug. The overlay's "Recurring hazards" section lists the ones known to bite in this repository; check them before hypothesising about the code.

### Tighten the loop

Treat the loop as a product. Once you have *a* loop:

- Faster? Cache setup, skip unrelated init, narrow the test scope.
- Sharper signal? Assert the specific symptom, not "didn't throw".
- More deterministic? Pin time, seed randomness, isolate the tenant, freeze network.

A 30-second flaky loop is barely better than none. A 2-second deterministic one is a superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100x, parallelise, add stress, narrow timing windows, inject sleeps. A 50% flake is debuggable, 1% is not — keep raising the rate until it is.

### When you genuinely cannot build a loop

Stop and say so, and list what you tried. Then put the way forward to the user with the **AskUserQuestion** tool, recommending the option most likely to unblock you: access to the environment that reproduces it, a redacted captured artifact (payload, log dump, screen recording with timestamps), or permission to add temporary instrumentation. **Do not proceed to hypothesise without a loop.**

### Completion criterion

Phase 1 is done when you can name **one command** that you have **already run at least once** (show the invocation and its redacted output), and that is:

- [ ] **Red-capable** — drives the real bug path and asserts the user's exact symptom, so it goes red now and green after the fix. Not "runs without erroring".
- [ ] **Deterministic** — same verdict every run (or a pinned, high reproduction rate).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Runnable unattended.**

If you catch yourself reading code to build a theory before this command exists, **stop**. Jumping to a hypothesis is the exact failure this skill prevents. No red-capable command, no Phase 2.

## Phase 2: Reproduce and minimise

Run the loop. Watch it go red.

- [ ] The failure is the one **the user described**, not a nearby one. Wrong bug, wrong fix.
- [ ] It reproduces across runs.
- [ ] The exact symptom is captured, so later phases can prove the fix addresses it.

Then shrink to the **smallest scenario that still goes red**. Cut inputs, callers, config, data and steps **one at a time**, re-running after each cut. Done when every remaining element is load-bearing: removing any one turns it green.

A minimal repro shrinks the hypothesis space and becomes the regression test in Phase 5. Do not proceed without both reproducing and minimising.

## Phase 3: Hypothesise

Generate **3-5 ranked hypotheses before testing any of them** — a single hypothesis anchors you on the first plausible idea.

Each must be falsifiable: state its prediction.

> "If `<X>` is the cause, then `<changing Y>` makes it disappear / `<changing Z>` makes it worse."

No prediction means it is a vibe — sharpen or discard it.

**Show the ranked list to the user before testing**, with the **AskUserQuestion** tool — your top-ranked hypothesis first, each option carrying its falsifiable prediction. They often re-rank it instantly ("we deployed exactly that on Tuesday") or have already ruled one out. Cheap checkpoint, large saving. Do not block on it — proceed with your ranking if there is no answer.

## Phase 4: Instrument

Every probe maps to a specific prediction from Phase 3. **Change one variable at a time.**

1. Debugger or REPL inspection where the environment allows — one breakpoint beats ten logs.
2. Targeted logs at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`, so cleanup is one grep. Untagged logs survive forever.

**Performance branch.** For regressions, logs are usually the wrong tool. Establish a baseline measurement first — timing harness, profiler, `EXPLAIN ANALYZE` on the query — then bisect. Measure first, fix second.

## Phase 5: Fix and regression test

Write the regression test **before the fix**, but only if a **correct seam** exists — one where the test exercises the real bug pattern as it occurs at the call site. A seam too shallow to replicate the chain that triggered the bug gives false confidence.

**If no correct seam exists, that is itself the finding.** State it: the architecture is preventing the bug from being locked down.

With a correct seam:

1. Turn the minimised repro into a failing test there.
2. Watch it fail.
3. Apply the smallest fix.
4. Watch it pass.
5. Re-run the Phase 1 loop against the original, un-minimised scenario.

## Phase 6: Cleanup

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop).
- [ ] Regression test passes, or the absence of a seam is documented.
- [ ] All `[DEBUG-...]` instrumentation removed — grep the prefix to prove it.
- [ ] Throwaway harnesses deleted or moved to the scratchpad.
- [ ] The hypothesis that turned out correct is stated in the report and in the suggested commit message, so the next person learns from it.

Never commit, push or run migrations as part of this skill unless explicitly told to.
