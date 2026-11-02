# Plan file

`~/.claude/context/<main-tree-basename>/plans/<slug>.md`, outside the working tree. Written by `plan`, kept current by `implement`. It is the state of the run: everything a new session needs is here, because a conversation may not survive that long.

**Keep the keys exactly as written, in English**; the content follows the user's language.

```markdown
# <title>

main: <parent of `git rev-parse --path-format=absolute --git-common-dir`, exactly as git prints it>
base: <BASE_SHA>
dirty: <paths dirty before the plan, or none>
commits: per-milestone | none
branch: <name, or none>
tip: <commit or tree the run last closed on; starts as base>
closing: todo | doing | stopped | done
closing-rounds: 0
closing-result: <why closing stopped, or none>

## Spec

DECISIONS
- ...

OUT OF SCOPE
- ...

ACCEPTANCE CRITERIA
- ...

OPEN RISKS
- ...

## Contract

<the CONTRACT block, or none>

## Milestones

### M1 <goal>

status: todo | doing | stopped | done
checkpoint: none | before — <reason> | after — <reason>
approved: <date the user gave the go-ahead, or none>
rounds: 0
scope: <paths>
start: <entry-point paths and symbols>
acceptance:
- <observable behavior>
verify: <command>
point: <commit or tree this milestone ended on>
result: <one line: what happened, or why it stopped>

## Corrections

- <date> — <the correction, in the user's words>

## Log

- <M1> — <decisions taken during the run, scope widened, follow-ups, MEDIUM findings left open>
```

Milestones run in the order they are listed.

## The fields that carry the run

- `main` — binds the plan to one repository. The folder is named after the repository's basename, which a clone chooses, and `verify` commands run unattended. Compared with separators normalized, and without regard to case on Windows.
- `base` and `dirty` — the baseline of the whole plan. A resumed run uses these rather than recording a new one, so finished milestones are not mistaken for someone else's work.
- `branch` — set whenever commits are made or the repository has a workspace config, so a later session finds the work.
- `approved` — the go-ahead for a checkpoint, in the file and not only in a conversation. Without it, a new session has nothing to tell a checkpoint already passed from one that was not.
- `rounds` — every time code changes in answer to a failed check or a review finding, across both. Written down each time, because a counter held in memory does not survive compaction. `closing-rounds` is the same for the closing phase.
- `tip` — the one place the run compares reality with. It moves every time a milestone or the closing phase closes, and a correction never moves it, so a plan with reopened milestones can still tell its own work from someone else's. A milestone is reviewed from `tip` to now: that milestone and not the ones before it.
- `point` — where each milestone ended, for going back to it.
- `Log` — what the final report is built from.

## Status

- `todo` → `doing` when the work starts, after the checkpoint check.
- `doing` → `done` when the milestone is closed.
- `doing` → `stopped` when work is left unfinished. A `checkpoint: after` is not that: the milestone stays `done` and the run waits for `approved`.
- `stopped` → `doing` once the user has answered. The answer goes to `Log`; after a budget stop it also buys one more round, so `rounds` drops by one.
- `done` → `todo` only through a correction.

`closing` moves the same way, with `closing-rounds` and `closing-result` in place of `rounds` and `result`.

## Applying a correction

Both `plan amend` and a correction given during a run do exactly this:

1. Add it to `## Corrections`, with the date, in the user's words.
2. Edit the milestones it touches that are not `done`.
3. If it invalidates a `done` milestone, set that milestone and every later one that built on it to `todo`: `rounds` to 0, `point` and `approved` cleared, the old `point` kept in `Log`. Set `closing: todo` and `closing-rounds: 0`, because the whole has to be looked at again. Show the user which ones.
4. If it changes a `DECISIONS` entry, edit the entry and say so. The spec and the milestones never disagree.

A correction costs no rounds.
