---
name: implement
description: Robust implementation workflow for features, bug fixes and refactors with bounded reconnaissance, production implementation, verification and risk-based review.
disable-model-invocation: true
argument-hint: "[task]"
---

# Implement

Execute `$ARGUMENTS` as the implementation orchestrator, optimizing in this order: correctness and completeness, verifiable behavior, predictable execution, token efficiency. Token efficiency means avoiding duplicated context and unnecessary agents — never skipping useful engineering work.

**Naming.** Sibling skills are written namespaced throughout — `claudius:diagnose` for a Skill-tool call, `/claudius:project-profile` for something the user types. Running this kit standalone from `~/.claude/` rather than as a plugin, drop the `claudius:` prefix everywhere.

**Reference files — read one only when you reach the phase that needs it.** Most tasks need none.

| File | Read it when |
|---|---|
| [CLASSIFY.md](./CLASSIFY.md) | the change is not on the fast path, or scopes may need splitting |
| [CONTRACT.md](./CONTRACT.md) | you are freezing a contract or briefing a worker |
| [REVIEW.md](./REVIEW.md) | review is triggered by section 5 |
| [REPORT.md](./REPORT.md) | you are writing the final report |

## Ask, do not guess

Whenever you block on a decision that is the user's — an ambiguous contract, a choice between real alternatives, plan approval — ask with the **AskUserQuestion** tool, as options they can pick, with your recommendation first and marked. A numbered list buried in prose costs them a turn of typing. Free text stays available through "Other".

Do not manufacture an approval turn for routine implementation whose contract is already clear.

## 0. Baseline

Once, at the start:

```bash
git rev-parse --short HEAD && git status --porcelain
```

Record `BASE_SHA` and pre-existing dirty paths. Never overwrite unrelated work. Never perform git writes unless the user explicitly asks.

## 1. Two gates before any code

**Alignment gate.** If the request leaves a material decision open — the rule behind the example, which data is affected, who may do it, what is out of scope — settle it **before** classifying, with the AskUserQuestion tool, one round of options with your recommendation first.

When the ambiguity is deep enough to need the full design tree rather than a round or two, stop and ask the user to run `/claudius:grill <topic>` themselves; `grill` is reserved for explicit user invocation and cannot be called from here. When the interview has already happened, its `DECISIONS`, `OUT OF SCOPE`, `ACCEPTANCE CRITERIA` and `OPEN RISKS` blocks **are** the frozen contract and the spec — `OUT OF SCOPE` included, because that is what the review's spec axis checks scope creep against. Skip the gate entirely when the request is already unambiguous.

**Diagnosis gate.** For a bug whose cause is not obvious from a stack trace or the user's own diagnosis, call the Skill tool with "claudius:diagnose" and complete at least its Phase 1 and 2 — a red-capable command plus a minimised repro — before writing any fix. **No red-capable command, no implementation.** The minimised repro is the regression test and the acceptance criterion. When the cause *is* obvious, say why in one line and proceed.

## 2. Fast path

**A small, local change goes straight into the code.** No contract block, no worker, no reviewer, no plan approval — read what you need, make the change, run the one relevant check, report in three lines.

This is the default for a change that is confined to one area, has an obvious implementation, and touches none of the triggers below.

**Risk triggers — the canonical list.** Hitting any one of these means the change is not small, whatever its line count: stop, and go to section 3. The same list classifies a change as high-risk and makes review mandatory, so a new kind of risk is added here once and takes effect everywhere.

- database schema, migrations, or a write that changes existing rows
- a public API, a cross-layer contract, an emitted event, or a shared type
- authentication, authorization, permissions, or input validation at a boundary
- transactions, concurrency, ordering, or idempotency
- an effect that leaves the system: payments, third-party calls, messages, stock
- generated files, lockfiles, or anything the repository marks as not hand-edited
- more than one layer, or roughly more than five files
- non-trivial new business logic in a place that has no test covering it

When one fires mid-implementation, say so in one line and pick the discipline back up — do not finish on the fast path because you already started there.

## 3. Classify and plan

Not on the fast path? Choose the workflow by engineering risk — see [CLASSIFY.md](./CLASSIFY.md) for the tiers and the parallelism rules. Freeze a contract only for details that must stay consistent across layers or workers; the format is in [CONTRACT.md](./CONTRACT.md).

Reuse facts already established in this conversation. Read `~/.claude/context/<repo-basename>/PROJECT.md` (verified commands, seams, hazards, enforced rules) and `CONTEXT.md` (domain glossary) when they exist — never create them in the working tree. Neither is required; without them, resolve the same facts from the repository and consider `/claudius:project-profile` afterwards.

When uncertainty remains, run one focused `Explore` for the current implementation, the best analogous pattern, reusable helpers, and contract touchpoints. Ask for paths, symbols and conclusions — never file dumps. A second `Explore` is justified only for an independent question.

When a genuinely new or contested domain term gets settled, call the Skill tool with "claudius:domain-model".

## 4. Implement and verify

**Write the code in the main conversation** for ordinary work. You already hold the context, and delegating only to read the whole diff back at integration buys nothing.

Send a `clean-code-engineer` when the work is genuinely large, when two scopes are provably disjoint and can run in parallel, or when the implementation would flood this context with detail nobody needs afterwards. Brief it per [CONTRACT.md](./CONTRACT.md); the rules for running a parallel wave are in [CLASSIFY.md](./CLASSIFY.md).

Then verify the combined result:

- one or two quiet targeted commands: run them here;
- verbose, numerous or slow commands, or where independent confirmation matters: send `test-runner`;
- high-risk work requires independent verification unless the environment prevents it.

Prefer targeted typecheck, lint and focused tests first; run a full build or suite only when it materially validates the change. On failure, fix within the original scope, re-run only the affected checks, and allow about two repair rounds before reporting the real blocker instead of cycling.

**Never hide a failure** through ignored diagnostics, unsafe casts, disabled lint rules, deleted tests, or quietly reduced acceptance criteria.

## 5. Review

Send a `code-reviewer` whenever any risk trigger from section 2 was hit, and additionally for a sizeable refactor or verification that left real uncertainty. For ordinary work, review when the logic is non-trivial and skip it for small, well-covered changes.

The axes, what to give each reviewer and how to handle findings: [REVIEW.md](./REVIEW.md).

## 6. Final gate and report

Before reporting success, confirm the behavior is complete rather than scaffolded, the combined diff matches the frozen contract, no unrelated work was overwritten, the checks have real results, material findings are resolved or reported, and manual steps are listed.

Ground the report in git, not in memory:

```bash
git --no-pager diff --numstat <BASE_SHA> && git --no-pager diff --name-status <BASE_SHA> && git status --porcelain
```

Worker reports supply the *why*; git supplies the *what*. If they disagree, git wins and the discrepancy is a risk. Format: [REPORT.md](./REPORT.md).

Do not commit, push, create branches or PRs, run migrations, or make destructive repository changes without explicit user instruction.
