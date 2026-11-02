---
name: plan
description: Turn a task too large for one implement run into an approved plan file — ordered vertical milestones, each with its scope, acceptance and verify command, kept privately — and show or correct it later. Use when the user says "plan this", "zaplanuj", "plan pracy", or hands over work that spans several reviewable changes. Writes no code: execution is `/claudius:implement plan <slug>`.
disable-model-invocation: true
argument-hint: "[task] | status [slug] | amend <slug> <correction>"
---

# Plan

Turn `$ARGUMENTS` into a plan the user approves once and then does not have to drive. The failure this prevents is a large task that is approved as a wish and discovered as a mess: milestones nobody can verify, a run that stops for nothing, or one that does not stop when it should.

Respond in the user's language. **This skill writes no code.** The plan is executed by `implement`, milestone by milestone, so a delegated task gets the same discipline as a manual one.

**The state lives in the file.** Resolve the private context directory once: the basename of the parent of `git rev-parse --path-format=absolute --git-common-dir`, under `~/.claude/context/`. Plans are `plans/<slug>.md` there, in the format of [PLAN-FORMAT.md](./PLAN-FORMAT.md). A slug matches `[a-z0-9-]+`; refuse anything else, because it becomes a path.

## Which call is this

- `status [slug]` — read the file and print: milestones with their status and rounds, the next action, any stop reason. Without a slug, list the plans here. Nothing is written.
- `amend <slug> <correction>` — see [Correcting a plan](#correcting-a-plan).
- Anything else is a task: continue below.

**When one `implement` run would do, say so and stop.** A change that fits one reviewable diff needs no plan file: give the user the line `/claudius:implement <task>`.

## 1. The spec comes first

A plan freezes decisions, so they must exist. If this conversation holds a `claudius:grill` block, copy its `DECISIONS`, `OUT OF SCOPE`, `ACCEPTANCE CRITERIA` and `OPEN RISKS` into the plan verbatim. The `spec` reviewer is checked against this copy, in a session that may never see this conversation.

Without a block, settle what is open in one round of **AskUserQuestion**, with your recommendation first, and write the block yourself. When the ambiguity is deeper than a round or two, stop and ask the user to run `/claudius:grill <topic>` and come back. `grill` is reserved for explicit user invocation; this skill does not run a second interview.

## 2. Facts

Read `PROJECT.md` and `CONTEXT.md` from the private directory when they exist, and run one focused `claudius:Explore` for the implementation, the analogous pattern and the contract touchpoints. Ask for paths, symbols and conclusions.

When the plan commits to something expensive to reverse and more than one reasonable approach exists, call the Skill tool with "claudius:challenge" now, before slicing. Skip it for what the user already weighed.

## 3. Slice

Freeze only what must stay consistent across milestones, in the `CONTRACT` format of [CONTRACT.md](../implement/CONTRACT.md). Then cut the work into milestones. Milestones run in the listed order. A good cut decides whether the run stays quiet, so hold each milestone to all of these:

- **Vertical.** A thin end-to-end path through every layer it needs, never "all the schema, then all the API". A horizontal slice cannot be verified until the last one lands, which is exactly when it is too late.
- **Done means observable.** Acceptance says what can be seen to work, and `verify` is a command that fails while it does not.
- **Reviewable.** One reviewer can hold the diff in their head. If not, cut it again.
- **It leaves the repository working.** The run can stop after any milestone and what is there still builds and passes.
- **Riskiest first.** The milestone most likely to disprove the plan goes as early as dependencies allow, so a bad plan costs one milestone rather than five.

Two to seven milestones. More usually means the task is several plans; say so.

**Try every `verify` command once now**, except one with side effects, or one on a milestone with `checkpoint: before`, which waits for that go-ahead.

- Failing because the behavior does not exist yet is the point.
- Failing because the command is wrong is a stop you would otherwise meet unattended, so fix it here. A test file that does not exist yet is not wrong; say in the milestone what it will fail on.
- Passing already means it cannot show the milestone is done. Replace it.

## 4. Place the checkpoints

The run stops on its own only at checkpoints, so where they are is the plan's most important decision. Set `checkpoint: before` yourself, without being asked, on any milestone that:

- runs a migration or anything destructive,
- has an effect that leaves the system,
- rests on an `OPEN RISKS` item that could invalidate what follows.

`implement` may do these only on explicit instruction; a plan approved as a whole is not that instruction, and the checkpoint is where it is given. Add `checkpoint: after` where the user will want to see the result before more is built on it, typically the first vertical slice. Every other milestone runs through.

## 5. Approve

Show the plan: milestones with goal, scope, verify and checkpoints, and the contract. Then ask with **AskUserQuestion**, once:

- **The plan** — approve, or say what to change. Your recommendation first, as everywhere.
- **Commits** — `per-milestone` on a named branch (recommended: a separate diff and a way back for each milestone, and this answer is the explicit instruction `implement` needs to commit) or `none` (nothing is committed; each milestone is held as a tree snapshot, and rolling one back is a manual step).

Revise and ask again until it is approved. Nothing is written before that.

## 6. Write and hand off

Record `BASE_SHA` with `git rev-parse --short HEAD`, the paths already dirty from `git status --porcelain`, and `main` as [PLAN-FORMAT.md](./PLAN-FORMAT.md) defines it. A plan never holds the same path in `dirty` and in a `scope`, because that work could be neither committed nor reviewed: ask the user to commit or put it away, or take it out of the scope. Name a `branch` whenever commits are made or the repository has a workspace config. Refuse a slug that already has a file, because that file may be a run in progress. Write the plan in the format of [PLAN-FORMAT.md](./PLAN-FORMAT.md).

**Do not start implementing.** `implement` is reserved for explicit user invocation, so close by giving the user the exact line:

```
/claudius:implement plan <slug>
```

## Correcting a plan

During a run, the user just says it, and `implement` records it. Between runs, `amend` does the same: follow "Applying a correction" in [PLAN-FORMAT.md](./PLAN-FORMAT.md).

## Naming

Running this kit standalone from `~/.claude/` rather than as a plugin, drop the `claudius:` prefix; `/plan` then collides with Claude Code's built-in, so rename this skill.
