---
name: workspace
description: Isolate work in progress the way a repository has opted in to — a worktree slot from a reusable pool, or a branch of the main checkout. Use only in a repository whose session start printed a [workspace] line, when an edit was refused as shared ground, or when the user explicitly asks to set up, switch, pause, check or clean up this workspace ("skonfiguruj workspace", "tryb pracy", "worktree slot", "posprzątaj worktree"). Never to push this workflow onto a repository that has its own.
argument-hint: "[init | take <branch> | release | mode <worktrees|branches|off> | status | sweep]"
---

# Workspace

Work in progress needs its own place. A repository opts in through a private `workspace.json` and picks one of two modes; the user can switch between them, or pause the whole thing, at any time with `mode`.

**This is opt-in, never imposed.** A repository without `workspace.json` keeps its own workflow — its own worktree scripts, branch habits or none at all. There, follow the repository's and the user's instructions and do not suggest this one unless they ask for it. `mode off` pauses a configured repository without deleting anything; `CLAUDIUS_WORKSPACE=off` switches the feature off everywhere.

- **worktrees** — several sessions at once. Each takes a slot from a pool of long-lived worktrees beside the repository (`../<repo>-worktrees/slot-N` unless configured otherwise). Only the branch changes between tasks, so dependencies, caches and env files stay warm, where a fresh worktree per task would reinstall everything and linger after the merge.
- **branches** — one session at a time. `take` switches the main checkout to a work branch; nothing else is created on disk.

The CLI is `bin/workspace.mjs` in this plugin, two directories above this file; the session-start line and the edit guard print its full path. Progress goes to stderr; `take` prints the working path as its last stdout line.

## worktrees mode

1. **Claim before the first edit**: `node <plugin>/bin/workspace.mjs take <branch-name>`, following the repository's branch convention. A new branch starts from the configured base; an existing one is checked out; a branch already sitting in a slot whose session has ended is resumed in that slot, work included.
2. **Switch the session into it**: `EnterWorktree` with `path` set to the printed slot. Working directory, `CLAUDE.md`, shell and write access move there, and so do subagents started afterwards. Claude Code asks the user once to approve a move outside `.claude/worktrees/`, and refuses a jump from one such slot straight into another — `ExitWorktree` first.
3. **Finish**: commit and push, `node <plugin>/bin/workspace.mjs release` from inside the slot, then `ExitWorktree` with `action: "keep"`. Never `action: "remove"` — slots are locked and meant to be reused.

When a session ends, its slots return to the pool on their own if nothing in them would be lost. A crashed session's slot is reclaimed by the next `take` once clean and pushed, and otherwise shows as `orphaned` until its branch is taken again.

## branches mode

1. **Start a branch before the first edit**: `node <plugin>/bin/workspace.mjs take <branch-name>`. It refuses while the checkout has uncommitted changes, so one task's edits never travel onto another's branch. Commit them, or ask the user.
2. **Finish**: commit and push, then `node <plugin>/bin/workspace.mjs release` — back to the base branch, fast-forwarded.

The edit guard refuses protected paths while the checkout sits on a protected branch (the base, `main`, `master`) or a detached HEAD. If another session is clearly working in the same checkout, say so and suggest `mode worktrees` rather than working around it.

## In both modes

`release` refuses while anything is uncommitted or unpushed. `--force` discards that work — the user's call, never a way past the refusal. A released branch stays, so an open pull request resumes with `take <same-branch>`.

`status` shows the mode, every slot and worktree with its pull request. `sweep` lists slots and old worktrees whose pull request has merged or whose session has ended; `sweep --yes` frees and removes them. Removing is the user's call — show the dry run first.

`mode` prints the current mode; `mode worktrees` / `mode branches` / `mode off` switches it in the private config. Switch only when the user asks.

## Setting up a repository

Only when the user asks. The config lives in the private overlay, never in the working tree: `~/.claude/context/<main-tree-basename>/workspace.json`.

1. **See what the repository suggests**: `node <plugin>/bin/workspace.mjs init --dry-run`. It reads the repository and prints a proposal with the reason for every value — base branch, where existing worktrees already live, code folders, caches, env files, the install step — plus hints for what it will not guess, such as code generators. It writes nothing.
2. **Ask only what is the user's to decide**, as pickable options with the proposal marked as recommended: the mode (`worktrees` for several sessions at once, `branches` for one), how many slots, and which folders the edit guard protects. Mention the pool folder and prefix if they might want other names.
3. **Write it**: `init` with their answers as flags — `--mode`, `--size`, `--protect "apps/,libs/"`, `--pool`, `--prefix`, `--base`. It refuses to replace an existing config unless given `--force`, and the user's own config always wins over a proposal.
4. **Add what detection cannot know**: a generator step the hints point at, a native build to copy. Verify each `prepare` command by running it once.

The fields, for editing by hand:

- `mode` — `worktrees` (default), `branches` or `off`.
- `pool` — the folder slots live in, relative to the main tree; `../<repo>-worktrees` when absent. `.claude/worktrees` removes the approval prompt on entry and allows jumping between slots, at the price of slots inside the repository and paths about 26 characters longer.
- `prefix` — slot folders are named `<prefix>-1`, `<prefix>-2`, …; `slot` when absent.
- `size` — how many sessions really run at once. Each slot holds a full dependency tree.
- `base` — a ref, or a glob such as `origin/release/*` for the newest matching branch.
- `protect` — path prefixes the edit guard watches. Leave out what is legitimately edited in place (docs, agent config). Empty means no guard.
- `protectedBranches` — branch mode only: globs never edited directly. Defaults to the base without its remote, plus `main` and `master`.
- `keep` — `git clean -e` patterns that survive between tasks in a slot: whatever is slow to rebuild.
- `copy` — untracked files a checkout cannot recreate, copied from the main tree into a slot's gaps (after `prepare` as well, so a build directory inside dependencies can be seeded).
- `prepare` — shell lines run after every switch, in both modes. With `when` (paths or `*` globs, e.g. `libs/*/prisma/schema/*.prisma`), only when those files changed since the step last ran there; keep unconditional steps cheap and cache-backed.

A pool inside the repository is added to `.git/info/exclude` automatically. Tools that walk the tree without reading git's ignore rules need their own ignore entry for it — check the build system (Nx reads `.nxignore`, for instance) and tell the user if one is missing rather than editing a tracked file. On Windows, measure the deepest dependency path in a slot; past 260 characters, tell the user that enabling `LongPathsEnabled` removes the limit.
