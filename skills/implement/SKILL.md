---
name: implement
description: Robust implementation workflow for features, bug fixes and refactors with bounded reconnaissance, production implementation, verification and risk-based review.
disable-model-invocation: true
argument-hint: "[task]"
---

# Implement

Execute `$ARGUMENTS` as the implementation orchestrator, optimizing in this order: correctness and completeness, verifiable behavior, predictable execution, token efficiency. Token efficiency means avoiding duplicated context and unnecessary agents — never skipping useful engineering work.

**Naming.** Sibling skills are written namespaced throughout — `claudius:diagnose` for a Skill-tool call, `/claudius:project-profile` for something the user types. Running this kit standalone from `~/.claude/` rather than as a plugin, drop the `claudius:` prefix everywhere. The same goes for the `Explore` agent: a bare `Explore` is Claude Code's built-in one, so this kit's is `claudius:Explore`.

**Reference files — read one only when you reach the phase that needs it.** Most tasks need none.

| File | Read it when |
|---|---|
| [CLASSIFY.md](./CLASSIFY.md) | the change is not on the fast path, or scopes may need splitting |
| [CONTRACT.md](./CONTRACT.md) | you are freezing a contract or briefing a worker |
| [QUALITY.md](./QUALITY.md) | you are about to write code yourself |
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

## 1. Three gates before any code

**Objection gate.** A request is not a settled decision just because it arrived as an instruction. If you would solve this differently — the problem is already solved elsewhere in the repository, a smaller change buys the same result, the approach fights a pattern the codebase relies on — say so **before** classifying: the objection, the evidence for it (`path:line`, a documented rule, a concrete failure scenario), and the alternative, in three lines or fewer. Then let the user choose, and carry out what they choose without reopening it.

An objection needs evidence; a preference is not one, and neither is a risk that applies to every change. **Having none is the normal case** — then say nothing and proceed. Never invent a concern to look rigorous, and never soften one that is real.

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

When uncertainty remains, run one focused `claudius:Explore` for the current implementation, the best analogous pattern, reusable helpers, and contract touchpoints. Ask for paths, symbols and conclusions — never file dumps. A second `Explore` is justified only for an independent question.

When the plan commits to something expensive to reverse — a schema or stored-data shape, a public contract, an effect that leaves the system, a new dependency or architectural seam — and more than one reasonable approach exists, call the Skill tool with "claudius:challenge" **before** freezing the contract. One independent read, not a panel. Skip it when the alternatives were already weighed with the user, such as in a `claudius:grill` `DECISIONS` block, and for anything a revert undoes.

When a genuinely new or contested domain term gets settled, call the Skill tool with "claudius:domain-model".

## 4. Implement and verify

**Who writes the code is a ratio, not a default.** Weigh the size of an honest brief against the size of the work it would describe.

- **Send a `clean-code-engineer`** when the work is mechanical and specifiable — a test suite, boilerplate, the same edit repeated across many files, a migration — so that a few hundred tokens of brief buy thousands of tokens of work. Two provably disjoint scopes that can run at once qualify too.
- **Write it here** when the decisions are dense: when the brief would approach the size of the result, or when every other paragraph is a judgement the worker can neither make nor ask about.

Both sides cost something real. A worker's exploration — every file read, every dead end, every screen of test output — dies with its context, while the same work done here stays in this conversation for the rest of the session; on a typical multi-file change that is roughly four times less of this context spent, counting the report and the diff you still have to read at integration. Against that: the model here is stronger, it already holds the conversation, and a brief that turns out to be incomplete costs the repair twice. Neither consideration wins in general — decide per task, and say in one line which way you went and why.

Read [QUALITY.md](./QUALITY.md) before the first edit. The bar applies to whoever writes the code: the stronger model in this conversation does not get to skip the checklist a delegated worker would have been held to.

Brief a worker per [CONTRACT.md](./CONTRACT.md); the rules for running a parallel wave are in [CLASSIFY.md](./CLASSIFY.md).

Then verify the combined result:

- one or two quiet targeted commands: run them here;
- verbose, numerous or slow commands, or where independent confirmation matters: send `test-runner`;
- high-risk work requires independent verification unless the environment prevents it.

Never brief a `test-runner` to run suites in the background or side by side, and never launch two of them at once: concurrent full suites multiply their worker pools and can freeze the developer's machine. A full regression is one project after another, with workers capped — the runner knows how.

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
