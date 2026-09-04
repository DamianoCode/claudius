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

The bottom three fire on their own when the task calls for them; you never type those.

`implement` keeps its reference material in separate files — [CLASSIFY](skills/implement/CLASSIFY.md), [CONTRACT](skills/implement/CONTRACT.md), [REVIEW](skills/implement/REVIEW.md), [REPORT](skills/implement/REPORT.md) — and reads one only on reaching the phase that needs it. A one-line fix never pays for the review chapter.

### Agents

`Explore` (haiku, read-only recon) · `clean-code-engineer` (sonnet, implementation inside an explicit write scope) · `test-runner` (haiku, isolated verification) · `code-reviewer` (opus, review on one explicit axis).

The model tiering is deliberate: reconnaissance and verification are cheap and mechanical, review is where judgement has to be paid for. Ordinary implementation stays in the main conversation, which already holds the context — a worker has to buy more than the briefing, the report and the integration read it costs.

### Hooks

- **`SessionStart`** — tells you when a project overlay has gone stale relative to the manifests, rules and schemas it was built from. Silent when fresh, and silent when there is no overlay at all.
- **`PostToolUse`** — collapses long successful test/lint/build output to the lines that carry signal, deciding from the shape of the output rather than a list of command names. Anything that looks like a failure passes through whole.
- **`SubagentStop`** — refuses a worker that stopped without editing anything or without its completion report, and asks it to continue in the same context once. Never loops.

## Three ideas worth stealing even if you take nothing else

**Review on separate axes.** A change can pass one axis and fail another: code that follows every convention while implementing the wrong thing, or code that does exactly what the ticket asked while breaking the codebase's patterns. `code-reviewer` takes `AXIS: correctness | standards | spec` and, on high-risk work, runs them as parallel instances so neither contaminates the other's context. The findings are never merged or reranked across axes — that reranking is what lets one axis mask another.

**Facts are the agent's job, decisions are yours.** `grill` will not ask you anything it can look up. It dispatches exploration for the facts and blocks only on the decisions that are genuinely yours — and it asks them as options you click, with its own recommendation marked, so answering costs a click rather than a paragraph.

**Ceremony is priced per change.** A small local change goes straight into the code with a three-line report. What ends that fast path is not line count but risk: schema, a public contract, auth, transactions, an effect that leaves the system. The trigger list is explicit, so the cheap path is cheap and the expensive path is never skipped by accident.

## The private context directory

Two files live per repository under `~/.claude/context/<repo-basename>/`, and **never inside the working tree** — a shared repository should not gain files that change how a whole team works:

- `PROJECT.md` — engineering mechanics: stack, verified commands, real seams, hazards, hard rules. Written by `project-profile`.
- `CONTEXT.md` — the domain glossary. Written by `domain-model`, one confirmed term at a time.

Both are optional. Without them every skill still works; it just re-derives the same facts from the repository on each run.

## Language

The skills and agents are written in English. They answer in whatever language you write in, and the private notes they produce follow the language your team actually speaks. Only the structural keys stay in English, because the skills and the hooks find each other by them: `DECISIONS`, `OUT OF SCOPE`, `ACCEPTANCE CRITERIA` and `OPEN RISKS` from an interview; `SCOPE`, `CHANGED`, `RESULT`, `REVIEW` and `AXIS` from the agents. Trigger phrases in a skill description are the other exception — they are matched against what the user actually types, so they stay multilingual.

## Development

The hooks are the only executable code here, and they are covered:

```
npm test
```

No dependencies — `node --test`, driving the hooks as subprocesses the way Claude Code actually invokes them. The scanner behind the `SubagentStop` guard lives in `hooks/lib/` so it can be driven by a fake chunk source: that is what turns "it stops at the first match" into something a test can prove, rather than a stopwatch reading that any implementation would pass. A separate suite checks that `hooks.json` still points at files that exist and that the report templates in `agents/*.md` still satisfy the guard. CI runs the same command on Linux and Windows, on Node 20 and 22, for every push and pull request.

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
