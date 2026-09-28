# Claudius

An implementation workflow for Claude Code. One orchestrator that classifies work by engineering risk, four subagents on tiered models, and the disciplines that prevent the two expensive failures: **building the wrong thing correctly**, and **fixing a bug you never actually located**.

Nothing here is a process framework. Every piece is a plain Markdown file you are meant to fork and rewrite.

## Install

```
/plugin marketplace add DamianoCode/claudius
/plugin install claudius@claudius
```

Then, once per repository:

```
/claudius:project-profile
```

**Plugin skills are always namespaced** with the plugin name, so everything you type here starts with `claudius:`. Rename the `name` field in `plugin.json` if you fork this and want a shorter prefix.

That builds a private overlay — commands, seams, hazards, rules — outside the repository, so the skills act concretely without carrying any one project's details in their own text.

## What you get

### Skills

| Skill | Invoked by | What it does |
|---|---|---|
| `/claudius:implement` | you | The orchestrator. Takes a small change straight into the code, and reaches for classification, a frozen contract, workers and review only when the change earns it. Reports from `git`, not from memory. |
| `/claudius:grill` | you | Relentless interview before code. Design tree worked in rounds, asked as pickable options rather than a wall of text. Produces the acceptance criteria `implement` then freezes. |
| `/claudius:project-profile` | you | Builds the private per-project overlay. Verified commands only. |
| `claudius:diagnose` | model | Six-phase bug discipline. Phase 1 is the whole skill: **no red-capable command, no hypotheses.** |
| `claudius:domain-model` | model | Glossary and decision records — kept private, never written into the repository. |
| `claudius:codebase-design` | model | Vocabulary for deep modules: interface, depth, seam, adapter, leverage, locality. |
| `claudius:workspace` | model | Work in progress in a reusable worktree slot or on a branch of the main checkout — per repository, switchable. Opt-in. |

The bottom four fire on their own when the task calls for them; you never type those.

`implement` keeps its reference material in separate files — [CLASSIFY](skills/implement/CLASSIFY.md), [CONTRACT](skills/implement/CONTRACT.md), [REVIEW](skills/implement/REVIEW.md), [REPORT](skills/implement/REPORT.md) — and reads one only on reaching the phase that needs it. A one-line fix never pays for the review chapter.

### Agents

`Explore` (haiku, read-only recon) · `clean-code-engineer` (sonnet, implementation inside an explicit write scope) · `test-runner` (haiku, isolated verification) · `code-reviewer` (opus, review on one explicit axis).

The model tiering is deliberate: reconnaissance and verification are cheap and mechanical, review is where judgement has to be paid for. Who writes the implementation is not fixed — it is decided per task by comparing the size of an honest brief against the size of the work, because a worker's exploration dies with its context while the same work done in the main conversation stays there for the rest of the session.

The agents name model aliases, not versions, so each tier follows Claude Code's current default for it. From Claude Code 2.1.280, `opus` is Claude Opus 5.5 — on Microsoft Foundry the alias still points at an older Opus. Its default effort is `medium`, one level below Claude Opus 5's; `code-reviewer` sets `high` explicitly, so the review tier does not drop a level with the upgrade. `effort` is ignored on the haiku agents, whose model has no effort levels, and takes effect only if their model is overridden.

### Hooks

- **`SessionStart`** — tells you when a project overlay has gone stale relative to the manifests, rules and schemas it was built from. Silent when fresh, and silent when there is no overlay at all. In a repository with a workspace config, also says in one line which mode it uses and how to start and finish work.
- **`PreToolUse`** — in a repository with a workspace config, refuses edits to protected paths on shared ground — the main tree in worktrees mode, a protected branch in branches mode — and answers with the command that fixes it. Silent everywhere else, and never spawns a process, because it runs on every edit.
- **`PostToolUse`** — collapses long successful test/lint/build output to the lines that carry signal, deciding from the shape of the output rather than a list of command names. Anything that looks like a failure passes through whole.
- **`SessionEnd`** — in worktrees mode, frees the ending session's slots when nothing in them would be lost. Never blocks an exit.
- **`SubagentStop`** — refuses a worker that stopped without editing anything or without its completion report, and asks it to continue in the same context once. Never loops. The request arrives as feedback rather than a hook error, which needs Claude Code 2.1.163 or later.

## Three ideas worth stealing even if you take nothing else

**Review on separate axes.** A change can pass one axis and fail another: code that follows every convention while implementing the wrong thing, or code that does exactly what the ticket asked while breaking the codebase's patterns. `code-reviewer` takes `AXIS: correctness | standards | spec` and, on high-risk work, runs them as parallel instances so neither contaminates the other's context. The findings are never merged or reranked across axes — that reranking is what lets one axis mask another.

**Facts are the agent's job, decisions are yours.** `grill` will not ask you anything it can look up. It dispatches exploration for the facts and blocks only on the decisions that are genuinely yours — and it asks them as options you click, with its own recommendation marked, so answering costs a click rather than a paragraph.

**Ceremony is priced per change.** A small local change goes straight into the code with a three-line report. What ends that fast path is not line count but risk: schema, a public contract, auth, transactions, an effect that leaves the system. The trigger list is explicit, so the cheap path is cheap and the expensive path is never skipped by accident.

## The private context directory

Up to three files live per repository under `~/.claude/context/<repo-basename>/`, and **never inside the working tree** — a shared repository should not gain files that change how a whole team works:

- `PROJECT.md` — engineering mechanics: stack, verified commands, real seams, hazards, hard rules. Written by `project-profile`.
- `CONTEXT.md` — the domain glossary. Written by `domain-model`, one confirmed term at a time.
- `workspace.json` — how work in progress is isolated: worktree slots or branches. See `skills/workspace/SKILL.md`.

The folder is named after the **main** working tree, so a session inside a linked worktree reads the same files.

All are optional. Without them every skill still works; it just re-derives the same facts from the repository on each run.

## Language

The skills and agents are written in English. They answer in whatever language you write in, and the private notes they produce follow the language your team actually speaks. Only the structural keys stay in English, because the skills and the hooks find each other by them: `DECISIONS`, `OUT OF SCOPE`, `ACCEPTANCE CRITERIA` and `OPEN RISKS` from an interview; `SCOPE`, `CHANGED`, `RESULT`, `REVIEW` and `AXIS` from the agents. Trigger phrases in a skill description are the other exception — they are matched against what the user actually types, so they stay multilingual.

## Development

The hooks are the only executable code here, and they are covered:

```
npm test
```

No dependencies — `node --test`, driving the hooks as subprocesses the way Claude Code actually invokes them. The scanner behind the `SubagentStop` guard lives in `hooks/lib/` so it can be driven by a fake chunk source: that is what turns "it stops at the first match" into something a test can prove, rather than a stopwatch reading that any implementation would pass. A separate suite checks that `hooks.json` still points at files that exist and that the report templates in `agents/*.md` still satisfy the guard. CI runs the same command on Linux and Windows, on Node 20 and 22, for every push and pull request.

## Workspace: worktrees or branches

Work in progress needs its own place, and how much isolation it needs depends on how many sessions run at once. `bin/workspace.mjs` gives each repository one of two modes, switchable at any time:

- **worktrees** — a small pool of long-lived worktrees beside the repository (`../<repo>-worktrees/slot-N`, folder and prefix configurable). Only the branch changes between tasks, so a warm slot is ready in seconds where a fresh `git worktree add` of a large monorepo takes minutes — and nothing is left lying around after the merge.
- **branches** — one checkout, one work branch per task. For a single session at a time; the guard keeps edits off the base branch.

```
node bin/workspace.mjs take feat/login    # worktrees: claim a slot (last line = its path) · branches: switch
node bin/workspace.mjs release            # refuses unpushed work
node bin/workspace.mjs init [--dry-run]   # propose a config from the repository, then write it
node bin/workspace.mjs mode branches      # or: mode worktrees · mode off · no argument shows the mode
node bin/workspace.mjs                    # status, with pull requests
node bin/workspace.mjs sweep [--yes]      # free / remove what has merged or been abandoned
```

Everything project-specific — mode, folders, base branch, protected paths and branches, what survives between tasks, which files to copy and which install steps to run when a lockfile changes — lives in the private `workspace.json`, so the repository itself gains nothing.

**Opt-in, never imposed.** Without a `workspace.json` nothing changes: the hooks stay silent, the CLI refuses to act and the skill does not suggest itself, so a repository with its own worktree scripts or branch habits keeps them. `node bin/workspace.mjs init` proposes a config from the repository — base branch, where existing worktrees already live, code folders, caches, env files, the install step — with the reason for each value, and writes it only when asked (`--dry-run` to look first). `mode off` pauses a configured repository without deleting anything; `CLAUDIUS_WORKSPACE=off` switches the feature off everywhere.

How the worktrees mode fits Claude Code rather than working around it:

- **Sessions move in with `EnterWorktree`.** After `take`, the session enters the slot by path: working directory, shell, `CLAUDE.md` and write access follow, and so do subagents. Claude Code asks once to approve the move out of the repository. `"pool": ".claude/worktrees"` removes that prompt and allows jumping between slots, but puts slots inside the repository with paths long enough to trouble Windows tooling.
- **Nothing a teammate pulls changes.** Slots sit outside the working tree (or, inside it, behind the repository-local `.git/info/exclude`); claims live in `.git/claudius-slots`, beyond the reach of a `git clean`.
- **Slots cannot be swept away.** Each one carries a `git worktree lock`, which Claude Code's periodic worktree cleanup, `git worktree prune` and a plain `git worktree remove` all respect. A worktree without that lock is never treated as a slot, whatever its name.
- **Claims follow sessions.** A claim records the Claude Code session and process. `SessionEnd` frees the ending session's slots when nothing would be lost; a crashed session's slot is reclaimed when clean and pushed, and kept as `orphaned` — resumable by taking its branch — when it is not.
- **`claude --worktree` and subagent `isolation: "worktree"` are left alone.** A `WorktreeCreate` hook would replace that behaviour in every repository, not only the ones that opted in.

## Migrating from 0.1

Nothing you type changes: the skill names, the agent names and the invocations are identical. What changed underneath:

- `implement` split into a spine plus four reference files; the fast path is new.
- `grill` asks in rounds of pickable options, and its closing block uses English headings (`DECISIONS` / `OUT OF SCOPE` / `ACCEPTANCE CRITERIA` / `OPEN RISKS`) instead of Polish ones.
- Agents no longer force a Polish report; they answer in the user's language.
- The `SessionStart` hook no longer nags when a repository has no overlay.

## If you already run these files standalone

Installing the plugin on top of a `~/.claude/` copy of the same kit does **not** cleanly replace it:

- **Skills** coexist. Namespacing means `/implement` and `/claudius:implement` both stay available — two copies that will drift.
- **Agents** do not. A user or project `.claude/agents/` definition overrides a same-named plugin agent, so the plugin's agents stay inert until the originals are removed.
- **Hooks** double up. Both the `settings.json` entries and the plugin's `hooks.json` fire.

Pick one or the other: either keep the standalone files, or delete them and the hook entries from `settings.json` and let the plugin own the kit.

## Credits

The `diagnose`, `grill`, `domain-model` and `codebase-design` skills are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), as is the Fowler smell baseline used by the Standards review axis. The orchestrator, the agents, the hooks and the private-overlay convention are original.

MIT.
