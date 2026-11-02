# Running a plan

`$ARGUMENTS` is `plan <slug>`: execute an approved plan from `claudius:plan`, milestone by milestone. The user approved it so as not to drive. Run it through without asking, and stop only for what is listed under [Stops](#stops).

**This file adds a loop, not a second workflow.** Each milestone goes through sections 3 to 6 of [SKILL.md](./SKILL.md) with their tiers, verification, self-review and [REVIEW.md](./REVIEW.md) in force, as if the user had asked for it alone. Nothing unattended gets less than the same change run by hand.

## Load

Resolve the private directory as `plan` does and read `plans/<slug>.md`, in the format of [PLAN-FORMAT.md](../plan/PLAN-FORMAT.md), including its status rules. The file is the state. **At the start of every milestone and after any compaction, re-read the plan and this file.** A long run forgets both.

Then, in this order:

1. **Which plan.** A slug that does not match `[a-z0-9-]+`, or no such file: list the plans and stop. `closing: done` with every milestone `done`: say the plan is finished and stop.
2. **Whose plan.** `main` differs from this repository's main tree (the parent of `git rev-parse --path-format=absolute --git-common-dir`): refuse. A clone with the same folder name must not run another repository's `verify` commands.
3. **Baseline.** `BASE_SHA` and the pre-existing dirty paths come from `base` and `dirty`, in place of section 0.
4. **Where the work happens.** With a [workspace] line at session start, call the Skill tool with "claudius:workspace" and take `branch` with `--base <base>` before the first edit; the edit guard would otherwise refuse mid-run. Otherwise, with a `branch`, switch to it, creating it from `base` if needed. The plan's `commits` answer is the explicit instruction for this branch and these commits and nothing more: no push, no pull request, no amend.
5. **Is the run's work still there?** With `commits: per-milestone`, `tip` must be `HEAD` or its ancestor; commits above it are unfinished work of the run and are reviewed with it. With `commits: none`, `HEAD` must be `base`. Otherwise stop: milestones marked `done` are not in this history.
6. **Is anything left running?** A milestone or `closing` at `doing` may be a dead session or a live one, so ask once whether another session is running this plan, before touching it. When it is not, that work resumes as below.
7. **A `stopped` milestone or `closing`** has an open question: if the user has not answered it, show its `result` or `closing-result` and ask again. Write the answer per PLAN-FORMAT.md.
8. **Is the tree explained?** With nothing at `doing` or `stopped`, the tree must match `tip`: with commits, nothing dirty beyond `dirty`; with `commits: none`, a fresh [snapshot](#snapshots) equal to `tip`. With work in progress, every changed path must be in `dirty`, in a milestone's `scope`, or in `Log`. Anything else is a question, not a dead end: ask whose it is, and record the answer in `Log` without touching `result`. Work the user keeps is reviewed with the next milestone.

Say in one line what will run and which checkpoints are ahead. Writing to the plan file can raise a permission prompt in a mode that does not pre-approve it; `Edit(~/.claude/context/**)` in the user's allow rules removes that, and it is worth saying once when it happens.

## Each milestone

Take the first milestone that is not `done`. When none is left, the `checkpoint: after` check of step 1 still applies, then go to [Closing](#closing-the-plan).

1. **Checkpoints, before anything else.** If any `done` milestone has `checkpoint: after` and no `approved`, or this one has `checkpoint: before` and no `approved`, stop and wait. Write the go-ahead into `approved`. It covers that one milestone. A command being typed is not a go-ahead; only an answer to the checkpoint's question is.
2. **Start it.** Set `status: doing`. A milestone resumed from `doing` or `stopped` keeps its `rounds`, keeps the code, and goes through verification, self-review and review again whatever the code looks like, because the file cannot say how far the dead run got.
3. **Build it** through sections 3 to 6, keeping the section 6 gate and saving the report for the end of the plan. Its goal, `start`, `scope` and `acceptance` are the task; the plan's `Spec` and `Contract` are the frozen contract and spec, `OUT OF SCOPE` included. The alignment gate and `claudius:challenge` have been spent on what the plan decided. The diagnosis gate still applies to a bug met on the way. Weigh the writer as section 4 says, counting that a plan spends this one context across every milestone.
4. **`verify`** is the milestone's check, on top of whatever else its tier requires.
5. **Review only this milestone.** Reviewers get the diff from `tip` to now (with `commits: none`, take a [snapshot](#snapshots) first and diff the two trees), the milestone's goal, `acceptance` and `scope`, the plan's `Spec` and `Contract`, and the later milestones listed as not yet due, so that what they will deliver is not reported as missing.
6. **Close it.** With `commits: per-milestone`, commit the paths of this milestone and never a path in `dirty`. With `none`, take a snapshot. Record it as `point` and `tip`, set `status: done`, write `result`, and add to `Log` whatever the final report needs.
7. Go on with one line to the user and no question, unless step 1 stops the next one.

## Snapshots

With `commits: none`, a tree records the state without touching the index or the working tree, and a ref keeps it from being collected during a long stop. Exclude each path in `dirty`:

```bash
index="$(git rev-parse --path-format=absolute --git-path claudius-snapshot.index)"
GIT_INDEX_FILE="$index" git read-tree HEAD
GIT_INDEX_FILE="$index" git add -A -- ':/' ':(exclude,top)<dirty path>'
tree="$(GIT_INDEX_FILE="$index" git write-tree)"; rm -f "$index"
git update-ref "refs/claudius/<slug>/<tree>" "$tree"; echo "$tree"
```

## The budget

`rounds` counts every change made in answer to a failed check or a review finding, repairs and review fixes together, and it is written to the file each time. The limit per milestone is **3**: the two repair rounds of section 4 and the one round of fixes of REVIEW.md, spent in whatever order they fall. Closing has the same limit in `closing-rounds`.

With the budget spent, only two things stop the milestone: a red check, whether `verify` or any other the tier requires, and an unresolved `HIGH`. A `MEDIUM` left open goes to `Log` and the run continues, so a run is never held up by a judgement call.

## Stops

Stop for these and nothing else:

- a checkpoint,
- a red check or an unresolved `HIGH` with the budget spent,
- a check that cannot run for a reason outside the code (`BLOCKED`), which spends no rounds,
- a migration, a destructive action or an effect leaving the system that has no checkpoint in the plan,
- a material choice the plan does not cover and that is the user's,
- evidence that the plan is wrong: a milestone already done differently, an assumption the code disproves,
- a write outside the milestone's `scope` that touches a later milestone's scope or goes beyond the plumbing the change needs,
- a failed check from [Load](#load), or `take` refusing.

A narrow write outside `scope` that the change plainly needs is not a stop: record it in `Log` before making it, or at integration when a worker made it. A risk trigger is not a stop either: it sets the tier, as it always does.

**A stop writes before it speaks.** For unfinished work set `status: stopped` and put the reason in `result`, or `closing: stopped` and `closing-result`, then ask with **AskUserQuestion**: what happened, the evidence, what was tried, and the options with your recommendation first. The run can then be resumed from any session with the same command.

## Corrections during a run

The user can correct the course at any moment. Apply it per "Applying a correction" in [PLAN-FORMAT.md](../plan/PLAN-FORMAT.md), then continue unless it raises a stop.

## Closing the plan

When every milestone is `done`, look at the whole, which no milestone's review could. Set `closing: doing`. Stops apply here too.

1. Verify the combined result against `base`: the full relevant suite, through a `test-runner` per section 4.
2. Review per [REVIEW.md](./REVIEW.md), which decides how many reviewers, on the diff from `base` (with `commits: none`, to a new snapshot), with the `Spec` and `Contract`. Their task is what only shows across milestones: requirements that fell between them, scope creep that added up, helpers built twice, a contract that drifted. Its bounds apply. With `commits: per-milestone`, the fixes get one more commit, which becomes `tip`.
3. Report per [REPORT.md](./REPORT.md), against `base`, with one line per milestone and everything from `Log` that is still open.
4. Set `closing: done`. With `commits: none`, delete the plan's refs: `git for-each-ref --format='delete %(refname)' refs/claudius/<slug>/ | git update-ref --stdin`.

The plan file stays, as the record of the run.
