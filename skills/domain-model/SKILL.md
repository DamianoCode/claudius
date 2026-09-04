---
name: domain-model
description: Build and sharpen the project's domain glossary and decision records — privately, outside the repository. Use when discussing project terminology, when a term is ambiguous or overloaded, when writing or editing CONTEXT.md, or when recording a hard-to-reverse decision.
---

# Domain Model

Actively build and sharpen the project's domain model as you work: challenge terms, invent edge-case scenarios, and write the glossary and decisions down the moment they crystallise.

Merely *reading* the glossary for vocabulary is not this skill — that is a one-line habit any skill can do. This skill is for when you are **changing** the model.

## Where the files live — private, never in the repository

**These files are personal notes. They must never be written into the project working tree.** The repository is shared with other developers; adding a `CONTEXT.md` or `docs/adr/` there changes their workflow and is not what the user wants.

Resolve the location once:

```bash
git rev-parse --show-toplevel
```

Take the **basename** of that path and use:

```
~/.claude/context/<repo-basename>/
├── PROJECT.md          ← engineering overlay (owned by the project-profile skill, not this one)
├── CONTEXT.md          ← the glossary
└── adr/
    ├── 0001-slug.md
    └── 0002-slug.md
```

On Windows that is `C:\Users\<user>\.claude\context\<repo-basename>\`.

Create files lazily — only when there is something real to write. Never create a stub "to be filled in later".

Before writing, confirm the target path does not sit inside the repository working tree. If it does, stop and fix the path.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with what `CONTEXT.md` already defines, call it out immediately. "Glosariusz definiuje *X* jako A, a Ty chyba masz na myśli B. Które?"

### Sharpen fuzzy language

When a term is vague or overloaded, propose a precise canonical term. "Mówisz *konto* — masz na myśli klienta czy użytkownika? To różne rzeczy." Pick one, put the rest under `_Avoid_`.

### Discuss concrete scenarios

Stress-test relationships with specific scenarios. Invent edge cases that force precision about where one concept ends and the next begins — the half-completed case, the reversed-after-settlement case, the two-actors-at-once case.

### Cross-reference with code

When the user states how something works, check whether the code agrees. Surface contradictions: "W kodzie ta operacja działa na całości, a mówisz, że częściowa jest możliwa. Które jest prawdą?"

### Update CONTEXT.md inline

When a term is resolved, write it down there and then — do not batch. Format: [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` is a glossary and nothing else. No implementation details, no specs, no scratch notes, no process rules (story points, branching and release rules already live in the repository's own `CLAUDE.md` and are not domain terms).

### Offer an ADR sparingly

Only when all three are true:

1. **Hard to reverse** — changing your mind later costs real work.
2. **Surprising without context** — a future reader will ask "why on earth this way?".
3. **The result of a real trade-off** — there were genuine alternatives.

If any one is missing, skip it. Format: [ADR-FORMAT.md](./ADR-FORMAT.md).

## Seeding an empty glossary

When `CONTEXT.md` does not exist yet, do not invent terms. Harvest candidates from evidence — data-model and enum names, module, service and queue names, the vocabulary in recent commit messages and tickets — then put the ambiguous ones to the user as choices, a handful per round. A term enters the glossary only once the user has confirmed its definition.

Ten confirmed terms beat fifty guessed ones: a wrong glossary is worse than none, because everything downstream then uses the wrong word confidently.
