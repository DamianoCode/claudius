---
name: break
description: Attack one important feature or module to find where it fails — hostile input, boundaries, ordering, concurrency, failing dependencies — with one `breaker` agent that reports only what it made fail. Use when the user says "break this", "try to break", "popsuj to", "przetestuj na ostro", "znajdź dziurę". Not a step of implement, not a substitute for review, and not a security audit — that is `/claudius:security-audit`.
disable-model-invocation: true
argument-hint: "[feature or module]"
---

# Break

Send one `breaker` against `$ARGUMENTS` to find the inputs, orderings and failures under which it does the wrong thing. Review reads a diff and argues from the code; this runs the feature and shows it failing.

Respond in the user's language.

**On demand only.** This is never a step of `claudius:implement`. It is heavy — an opus agent running probes for as long as its budget allows — and it belongs on a feature that matters, when the user asks for it. **One `breaker`, never several**: a second one attacks the same code with the same model, doubles the load on the machine, and finds the same things.

## 1. Pin the target

Settle these before spawning anything. Resolve what the repository answers — entry points, how to run it, which tests already cover it — from the code and from `~/.claude/context/<repo-basename>/PROJECT.md` if it exists. Ask the user, with the **AskUserQuestion** tool, only for what is theirs to decide:

- **Invariants** — what must stay true. Propose them from the tests, types and validation, and let the user correct them. Without invariants a breaker cannot tell a bug from a design choice.
- **Environment** — where the attack runs: the test runner, a local server, a disposable database. **Never production**, and never shared data that somebody else depends on.
- **Allowed effects** — default none. When the target sends messages, takes payments or calls third parties and there is no sandbox or mock for it, say so and ask; do not let the breaker find out by trying.
- **Budget** — default about 30 minutes of attempts.

## 2. Brief one breaker

Write the brief yourself; do not forward the conversation.

```text
TARGET: <feature or module, entry points as path:symbol>
INVARIANTS: <what must stay true, one per line>
ENVIRONMENT: <exact commands to run the target or its tests>
ALLOWED EFFECTS: <none, or the exact ones>
PROBE DIR: <a fresh directory in this session's scratchpad>
BUDGET: <time or number of attempts>
```

Leave out anything that argues the feature is solid — how carefully it was built, which reviews it passed. A breaker told the code is good tries less hard where it matters.

Just before spawning, record a baseline of the working tree that also sees edits to files that are already modified: `git status --porcelain` and `git diff HEAD | git hash-object --stdin`. Then spawn it and do not run tests, builds, reviewers or another heavy command until it returns: it is using the machine.

## 3. Check every break before relaying it

The report is evidence, not a ruling.

- **Run each `REPRO` yourself**, after bringing up its `SETUP`; stop whatever you started once you are done. A break that does not fail for you is dropped, and you say so. One that fails only sometimes is reported as flaky, with the rate.
- **Check each one against the invariants.** A failure that breaks an invariant the breaker only `ASSUMED` is a question for the user, not a bug.
- **Confirm the working tree is untouched**: both baseline commands must print what they printed before the breaker started. A difference means the breaker wrote into the repository — show the user what changed, and do not revert it on your own.

Then report, briefly: the verdict; each confirmed break with its repro, expected and actual result, and severity; what was attempted and held; what stayed unproven and why. Name the `PROBE DIR` with its full path, so the probes can be reused.

## 4. Hand over, do not fix

**This skill ends at the report.** A confirmed break is a bug with a red-capable command already attached — exactly what `claudius:diagnose` asks for in its first phase, and the regression test its fix needs. Offer, in one line, to fix the breaks the user chooses through `/claudius:implement`; do not start fixing on your own.

Probes stay in the scratchpad. Moving one into the repository as a regression test is part of that fix, never a side effect of this skill.

## Naming

Running this kit standalone from `~/.claude/` rather than as a plugin, drop the `claudius:` prefix.
