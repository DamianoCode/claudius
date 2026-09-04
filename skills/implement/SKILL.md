---
name: implement
description: Robust implementation workflow for features, bug fixes and refactors with bounded reconnaissance, production implementation, verification and risk-based review.
disable-model-invocation: true
argument-hint: "[task]"
---

# Implement

Execute `$ARGUMENTS` as the implementation orchestrator. Optimize for this order:

1. correctness and completeness,
2. verifiable behavior,
3. predictable/fast execution,
4. token efficiency.

Token efficiency means avoiding duplicated context and unnecessary agents, not skipping useful engineering work.

Skill names below are written unprefixed (`grill`, `diagnose`, `domain-model`, `project-profile`). When this kit is installed as a plugin its skills are namespaced, so pass `claudius:grill` instead of `grill` — the same applies to every skill named in this file.

## 0. Baseline and existing work

Once at the start:

```bash
git rev-parse --short HEAD && git status --porcelain
```

Record `BASE_SHA` and pre-existing dirty paths. Never overwrite unrelated work and never perform git writes unless the user explicitly asks.

## 0.5. Two gates before any code

Both gates are cheap and both prevent the two failures that cost the most: building the wrong thing, and fixing a bug you never actually located.

**Alignment gate.** If the request leaves a material decision open — the rule behind the example, which data is affected, who may do it, what is explicitly out of scope — call the Skill tool with "grill" before classifying. Hand its `USTALENIA` / `KRYTERIA AKCEPTACJI` block into section 3 as the frozen contract and the spec. Skip the gate when the request is already unambiguous; a one-line fix does not need an interview.

**Diagnosis gate.** For BUGFIX work whose cause is not already obvious from a stack trace or the user's own diagnosis, call the Skill tool with "diagnose" and complete at least its Phase 1 and 2 — a red-capable command, plus a minimised repro — before writing any fix. **No red-capable command, no implementation.** The minimised repro becomes the regression test and the acceptance criterion. When the cause *is* obvious, say why in one line and proceed.

## 1. Classify the task

Choose the workflow by engineering risk, not only file count.

### MICRO
Mechanical/local change with obvious implementation, normally one file and no business/API/data contract change.

- Main conversation may implement directly.
- Run the narrow relevant check.
- No reviewer unless risk emerges.

### STANDARD
Normal feature/bug/refactor in one coherent area, usually several files but one owner/context.

- Use at most one focused `Explore` if important locations/patterns are not already known.
- Use one `clean-code-engineer` for the implementation.
- Verify after integration.
- Review if business logic is non-trivial or diff/risk justifies it.

### COMPLEX / HIGH-RISK
Cross-layer contract, public API, schema/data mutation, permissions/auth, external integration, concurrency/transactions, migration, or substantial refactor.

- Reconnaissance first.
- Freeze the relevant contract and work scopes.
- Use one implementation worker where shared context is strong; parallelize only truly independent scopes.
- Independent final verification is required.
- `code-reviewer` is required, on separate axes (section 7).

### PARALLEL
Use 2-3 implementation workers only when their write scopes are provably disjoint and parallel execution materially reduces work. Prefer sequential/shared-context implementation when workers would repeatedly need the same files or decisions.

Do not create an agent just because a phase exists.

## 2. Reconnaissance

Reuse facts already established in the current conversation or project instructions.

Read the private per-project files under `~/.claude/context/<repo-basename>/` when they exist — never in the working tree, never created there:

- `PROJECT.md` — verified commands, real seams, recurring hazards and the rules this repository enforces. Use its commands verbatim instead of guessing at a test or lint invocation.
- `CONTEXT.md` — the domain glossary, so contract, code and test names use the project's own vocabulary instead of inventing synonyms.

Neither is required; without them, resolve the same facts from the repository and consider running `/project-profile` afterwards so the next run does not repeat the work. When reconnaissance or implementation settles a genuinely new or contested domain term, call the Skill tool with "domain-model" to record it.

When uncertainty remains, run one `Explore` with a focused multi-part question covering the relevant subset of:

- current implementation and request/data flow,
- best analogous implementation,
- reusable helpers/services/types,
- contract touchpoints and contention files,
- concrete bug path for BUGFIX work.

A second Explore is justified only for an independent domain/question. Ask for paths, symbols, conclusions and unknowns — never file dumps.

The reconnaissance result should produce `START FILES` for implementation so the worker does not rediscover the repository from zero.

## 3. Contract, acceptance criteria and plan

Freeze only details that must stay consistent between layers/workers:

```text
CONTRACT
- DTO/types: <exact names/shapes or n/a>
- API/events: <method/path/payload/events or n/a>
- permissions/i18n: <keys or n/a>
- data/schema: <models/fields/relations or n/a>
- invariants: <business rules that implementations must share>

ACCEPTANCE
- <observable behavior 1>
- <observable behavior 2>

WORK
P1 <goal>
   WRITE SCOPE: <paths>
   START FILES: <paths/symbols>
   VERIFY: <targeted checks>
P2 ...
```

Ask the user to approve the plan before code only when a material decision is being introduced that is not already explicit in the request, especially public API/schema/auth/permission behavior, destructive migration/data behavior, or a genuinely ambiguous architectural choice. Do not create an approval turn for routine implementation whose contract is already clear.

Contention/shared files should normally be integrated by the orchestrator rather than owned concurrently by multiple workers.

## 4. Implement

Send each `clean-code-engineer` enough context to succeed without broad rediscovery:

```text
TASK: <one measurable outcome>
WRITE SCOPE: <exact paths>
START FILES: <best entry points from recon>
CONTRACT: <only relevant frozen items>
ACCEPTANCE: <relevant observable criteria>
PATTERN / REUSE: <known analogous paths/helpers>
DO NOT: <task-specific hazards only>
VERIFY SUGGESTION: <narrow check(s)>
```

Do not force an arbitrary low tool-call budget. The worker should search further when needed for correctness, but the prompt should make repeated broad reconnaissance unnecessary.

For parallel work:
- scopes must be disjoint,
- shared contract must already be frozen,
- keep parallel workers to 2-3,
- do not edit a worker's files while it is active,
- integrate `HANDOFF`/shared files after the wave.

## 5. Integration

After workers finish:

1. Inspect their `ASSUMPTIONS`, `PUBLIC CONTRACT`, `HANDOFF`, verification and risks.
2. Reconcile every assumption against the task/contract; do not silently change another layer to match an accidental worker deviation.
3. Apply shared/contention-file changes once.
4. Inspect the combined diff against `BASE_SHA` before final checks.
5. Check for duplicated helpers/contracts created independently by parallel workers.

If a worker stopped before completing a normal implementation, prefer continuing the same agent/context once. The `SubagentStop` guard may already request one automatic continuation. If the same worker repeatedly cannot complete, take over or re-scope instead of repeatedly spawning fresh agents.

## 6. Verification

Use two levels:

### Worker-level confidence
The implementation worker may run cheap targeted checks while coding. Treat these as useful evidence, not final integration proof.

### Final verification
After integration, verify the combined result.

- For 1-2 quiet, targeted commands, main may run them directly.
- Use `test-runner` when commands are verbose, numerous, slow, or you want independent verification/context isolation.
- HIGH-RISK work requires independent final verification unless the environment prevents it.
- Prefer authoritative targeted typecheck/lint/tests first; use full build/integration suite only when it materially validates the change.

On implementation-caused failure:
1. Send the concise failure evidence to the same owning `clean-code-engineer` when its context is useful.
2. Preserve original scope/contract and ask for the smallest correction.
3. Re-run only affected checks first, then the necessary final check.
4. Normally allow up to 2 repair rounds; after that report the real blocker rather than cycling.

Never hide a failure through ignored diagnostics, unsafe casts, disabled lint rules, deleted tests, or reduced acceptance criteria.

## 7. Independent review

Review when any of these apply:

- HIGH-RISK classification,
- public/cross-layer contract change,
- auth/permissions/validation/security boundary,
- schema/query/transaction/concurrency/data-integrity behavior,
- external integration,
- sizeable refactor or non-trivial new business logic,
- verification leaves meaningful uncertainty.

For ordinary STANDARD work, use judgment: review is valuable when logic is non-trivial; it can be skipped for small, well-covered changes with obvious behavior.

### Axes

`code-reviewer` reviews one explicit axis at a time, because a change can pass one and fail another: code that follows every convention while implementing the wrong thing passes **standards** and fails **spec**; code that does exactly what the ticket asked while breaking the repository's patterns does the reverse. Merging the axes lets one mask the other.

- **STANDARD work** — one `code-reviewer` with no `AXIS`, which reports all three in separate blocks.
- **HIGH-RISK work** — two or three `code-reviewer` instances **in parallel, in a single message**, one per axis, so neither contaminates the other's context. `AXIS: correctness` and `AXIS: spec` are the pair that always earns its cost; add `AXIS: standards` for sizeable refactors and new modules.

Give every reviewer:
- original task and acceptance criteria (the `/grill` block when there was one),
- frozen contract,
- `git diff <BASE_SHA> -- <relevant paths>`,
- relevant verification results.

Give the `spec` reviewer the spec and nothing that argues for the implementation; if there is no spec it must report `NO SPEC` rather than reconstruct one from the diff.

### Handling findings

Aggregate the blocks under their axis headings. **Do not merge or rerank across axes** and do not pick a single worst finding overall — that reranking is what the separation prevents.

For each HIGH finding, verify its evidence against the code before fixing. MEDIUM findings are fixed when credible and within task scope. A `spec` scope-creep finding is fixed by *removing* the extra behavior, not by justifying it. Advisory ideas belong in follow-ups, not automatic scope growth.

Beyond the axes above, do not spawn reviewer swarms.

After review fixes, rerun affected verification once.

## 8. Final quality gate

Before reporting success, confirm:

- requested behavior is complete, not merely scaffolded,
- combined diff matches the frozen contract/acceptance criteria,
- no unrelated pre-existing change was overwritten,
- authoritative checks have real results,
- material review findings are resolved or explicitly reported,
- migration/env/deploy/manual steps are listed,
- the final report is derived from actual git output, not from recollection.

## 9. Final report

First, ground the report in facts. Run once:

```bash
git --no-pager diff --numstat <BASE_SHA> && git --no-pager diff --name-status <BASE_SHA> && git status --porcelain
```

`--numstat` gives full untruncated paths and exact `+a/-b` counts; `--name-status` gives the add/modify/delete/rename marker. Do not use plain `--stat` here — it abbreviates long paths to `.../name.ts`, which destroys the clickable reference.

Build `CHANGED` from that output, never from memory of what the workers said they did. Worker `CHANGED` blocks supply the *why*; git supplies the *what*. If the two disagree, git wins and the discrepancy goes under `RISKS`.

Then report **as markdown, not inside a code fence** — fenced text renders as inert monospace, while plain markdown keeps `path:line` references clickable in the terminal.

### Format

**What changed** — one bullet per file, grouped by area when there are many. Mark each file `new` / `mod` / `del` / `ren`, give its `+a/-b` line delta from `--numstat`, and point at the key symbol with `path:line`. Say what the file now does differently, not that it was edited.

> **<area>**
> - `mod` `<path>:<line>` (+38/-6) — `<symbol>()` now rejects <case> instead of <old behavior>.
> - `new` `<path>` (+21/-0) — <what this file is for>.

Close with a one-line `TOTAL: <n> files, +<a>/-<b>`.

**Behavior** — one or two sentences: what a user could not do before and can do now, or what was broken and is now correct. If the change is invisible to users (refactor, types), say so plainly.

**Verification** — every command actually run, each with `PASS` / `FAIL` / `BLOCKED` and the reason for anything not green. Never list a command you did not run.

**Review** — one line per axis run (`correctness`, `standards`, `spec`): `OK`, `findings fixed — <count>`, or the unresolved findings themselves. Axes not run: `pominięty — <powód>`.

**Manual steps** — migrations, env vars, deploy actions, data backfills. `brak` if none.

**Risks / follow-ups** — material items only. `brak` if none.

**Commit suggestion** — `type(scope): message` per the repository's convention. State plainly that nothing has been committed.

### Scale the report to the change

For MICRO work, drop everything except the file bullets, verification and the commit suggestion. A three-line fix does not need eight headings.

For work with more than roughly fifteen changed files, group bullets by area and list individual files only where a reviewer needs to look; summarize the rest as `<n> further files — <what they have in common>`.

### Do not

Do not pad the report with files you did not touch, restate the task description back at the user, or narrate the process (which agents ran, what was searched). The user wants the resulting change, not the transcript.

Do not commit, push, create branches/PRs, run migrations, or make destructive repository changes without explicit user instruction.
