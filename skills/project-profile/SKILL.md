---
name: project-profile
description: Build or refresh the private engineering overlay for the current repository — stack, verified commands, testable seams, hazards and hard rules. Use when starting work in a new repository, when the other skills have no overlay to read, or when the stack has changed materially.
disable-model-invocation: true
---

# Project Profile

Produce `~/.claude/context/<repo-basename>/PROJECT.md`: the project-specific overlay that lets the generic skills (`diagnose`, `codebase-design`, `grill`, `code-reviewer`, `implement`) act concretely without carrying any one project's details in their own text.

## Rules

**Private, never in the repository.** Resolve the target once:

```bash
git rev-parse --path-format=absolute --git-common-dir
```

Take the basename of its parent directory — the main working tree, so a linked worktree resolves the same folder — and write to `~/.claude/context/<basename>/PROJECT.md`. Confirm the path does not sit inside the working tree before writing. The repository must end the run exactly as it started — check with `git status --porcelain`.

**Verified facts only.** Every command in the overlay must have been run or read out of a manifest, never guessed. A command that does not work is worse than an absent one, because the next run will trust it. Where two sources disagree, record both and say which to confirm.

**Mechanics, not language.** Domain terms belong in `CONTEXT.md` via the `domain-model` skill. Process rules that already live in the repository's own `CLAUDE.md` / `AGENTS.md` are not copied here — point at them instead.

## What to probe

Read rather than ask, then ask only about what the repository cannot tell you — and when you do ask, use the **AskUserQuestion** tool so the user picks an option instead of typing prose. Put your best reading of the evidence first, marked as the recommendation. Batch the gaps into one round of up to four questions rather than interrupting repeatedly.

1. **Stack and layout** — manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, …), workspace config, the app and library folders, what each one is.
2. **Commands, verified** — scripts in the manifest, task-runner targets (`nx show project <p> --json`, `turbo`, `make -qp`, `just --list`), the test runner actually configured, how to run **one** test file, typecheck, lint, build, and how to start the service locally. Note platform quirks (shell, env prefixes).
3. **Seams and honest coverage** — count test files per project against source files:

   ```bash
   git ls-files | grep -cE '(\.(spec|test)\.[cm]?[jt]sx?|_test\.(go|py)|(^|/)test_[^/]*\.py|Tests?\.(java|kt|cs)|_spec\.rb)$'
   ```

   Widen the pattern if the repository names its tests some other way. Record where a real seam exists and, just as importantly, where there is no test culture. An honest "no seam here" prevents fabricated confidence later.
4. **Feedback-loop building blocks** — the concrete ways to get a red signal in this project: one test file, an HTTP call against a local port, a direct database query, a queue job with a fixture payload, a replayed integration payload, a browser script.
5. **Recurring hazards** — the things that bite repeatedly: environment flags that silently disable behaviour, immutable migrations, multi-tenant or multi-environment blast radius, deprecated modules nobody should extend, commands known to damage the working tree.
6. **Hard rules** — what `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.claude/rules/*`, lint config and the code itself actually enforce: where types come from, where validation lives, what must be logged, how permissions are checked, translation-file conventions.
7. **Git and branching** — the branch model, the commit convention, and any versioning trap (a marker that bumps a major, a protected branch).
8. **Tracker** — where issues live and how they are reached.

## Output

Write the overlay with these headings, dropping any that the project genuinely has nothing for:

`# <repo> — overlay` (with the verification date) · Stack · Commands · Seams and test coverage · Feedback-loop building blocks · Recurring hazards · Hard rules the reviewer enforces · Git · Tracker.

Keep it dense and factual — a table beats a paragraph. Target one to two screens; this file is read on most runs, so every line must earn its place. Mark anything unverified explicitly as `unverified`.

Finish by reporting, in the user's language, what was written, which facts you verified by running something, and which remain unconfirmed.
