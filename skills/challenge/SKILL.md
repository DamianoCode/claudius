---
name: challenge
description: One independent second opinion on a proposed approach before it is built — is it worth building, and this way. Use when the user says "challenge this", "poke holes", "podważ to", "sprawdź ten pomysł", "czy to ma sens", or when a plan is about to commit to something expensive to reverse. Not for small or easily reverted changes, and not for reviewing code that already exists.
argument-hint: "[proposal]"
---

# Challenge

Get one independent read on `$ARGUMENTS` before any code is written. The failure this prevents is agreement by default: a plan that went ahead because nobody in the conversation had a reason to argue with it.

**One `skeptic`, never a panel.** Several agents with assigned attitudes — one to doubt, one to believe, one to judge — produce theatre: the same model, the same repository, and opinions decided by the role rather than by the evidence. What makes a second opinion independent is what it is given, not what it is told to feel. Here that is a clean context and a proposal stripped of the argument for it.

Respond in the user's language.

## When this earns its cost

A `skeptic` re-reads the repository from nothing. That is worth paying when the decision is expensive to reverse:

- a schema or stored-data shape, a public API or cross-layer contract,
- an effect that leaves the system,
- a new dependency, a new architectural seam, or a second way of doing something the repository already does one way,
- or the user asked for it — then run it whatever the size.

Do not run it for a change that a revert undoes, for fast-path work, or for a decision whose alternatives the user has already weighed — a `claudius:grill` `DECISIONS` block settles what it covers. When only one reasonable approach exists, say so in one line and skip.

## 1. State the proposal without selling it

Write the brief yourself; do not forward the conversation.

```text
PROPOSAL: <what would be built, concretely — the approach, not the wish>
GOAL: <the problem it is meant to solve, in observable terms>
CONSTRAINTS: <facts already established that any approach must respect, or none>
START FILES: <paths/symbols where the proposal lands>
```

Leave out **everything that argues for it**: why it was chosen, what was rejected, who proposed it — you or the user — and how far along it already is. An agent handed the case for a plan returns the plan confirmed. The alternatives you already considered stay out too; if the `skeptic` arrives at one of them on its own, that is a finding.

`CONSTRAINTS` is for facts, not preferences. "The API is consumed by a mobile client we cannot redeploy" belongs there; "we would rather not touch the schema" is part of the case and does not.

## 2. Send one skeptic

Spawn a single `skeptic` with that brief and nothing else. Carry on with whatever does not depend on its answer.

## 3. Check it, then put it to the user

The `skeptic`'s report is evidence, not a ruling. Before relaying it:

- **Verify the `STRONGEST OBJECTION` against the code** — open the `path:line` it cites. An objection that does not survive that check is dropped, and you say so.
- Weigh it against what the `skeptic` was deliberately not told. It could not see the conversation; a constraint it missed may answer its objection, and an alternative it proposes may be one already ruled out for a reason that still holds.

Then report, briefly: the verdict, the strongest objection with its evidence, the cheaper alternative, the cost to build, maintain and reverse — and **your own position in one line**, including when it differs from the `skeptic`'s and why.

- `PROCEED` — say so in one line. Do not manufacture a decision the user does not need to make.
- `CHANGE` or `STOP` that survived your check — put the choice to the user with the **AskUserQuestion** tool, your recommendation first and marked, each option saying what it costs.

The decision is the user's. Once they have made it, do not reopen it — record an objection they overruled as a risk in the final report, once, and move on.

**This skill ends at the opinion.** Called from a workflow already under way, such as `claudius:implement`, hand back to it and let it continue. Invoked on its own, stop after the report: a proposal that survived a challenge has not thereby been ordered, and `PROCEED` is a verdict on the idea, not an instruction to start building it.

## Naming

Running this kit standalone from `~/.claude/` rather than as a plugin, drop the `claudius:` prefix.
