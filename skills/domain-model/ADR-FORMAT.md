# ADR — format

ADRs live at `~/.claude/context/<repo-basename>/adr/`, numbered sequentially: `0001-slug.md`, `0002-slug.md`. Never in the repository.

Create the directory lazily, when the first ADR is needed. Scan for the highest existing number and increment.

Write the ADR in the language the team actually uses; the structure below is what matters, not the English wording of its headings.

## Template

```md
# <Short decision title>

<1-3 sentences: what the context was, what we decided, and why.>
```

That is it. An ADR can be one paragraph. The value is in recording **that** a decision was made and **why**, not in filling out sections.

## Optional sections

Include only when they genuinely add something. Most ADRs need none of them.

- **Status** (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful once decisions start being revisited.
- **Options considered** — only when the rejected alternatives are worth remembering.
- **Consequences** — only when non-obvious downstream effects need calling out.

## What qualifies

- **Architectural shape** — how the system is partitioned, how state is stored, how updates propagate.
- **Integration patterns** — how two modules or two systems talk, and why not the obvious way.
- **Technology choices carrying lock-in** — database, queue, auth, deployment target. Not every library; the ones that would take a quarter to swap.
- **Ownership and scope decisions** — which module owns which data, and what other modules may only reference by id. The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path** — bypassing the standard abstraction in one place, for a stated reason. These stop the next person from "fixing" something intentional.
- **Constraints invisible in the code** — contractual response times, compliance limits, a partner API that only accepts one request per second.
- **Rejected alternatives whose rejection is non-obvious** — otherwise the same suggestion returns in six months.

## What does not qualify

A decision that is easy to reverse (you will just reverse it), unsurprising (nobody will wonder why), or had no real alternative (there is nothing to record beyond "we did the obvious thing").
