---
name: grill
description: Relentless interview that stress-tests a plan, design or feature request before any code is written. Use when the user says "grill me", "przepytaj mnie", "dopytaj", when a request is large or ambiguous, or before starting COMPLEX / HIGH-RISK work.
disable-model-invocation: true
argument-hint: "[temat]"
---

# Grill

Interview the user relentlessly until you reach a shared understanding of `$ARGUMENTS`. The most common failure in this repository is not bad code — it is building the wrong thing correctly. This skill exists to make that failure visible before implementation, not after.

Answer in Polish. The user is the domain expert; you are the one who has to be sure.

## The design tree

Map the work as a **design tree**: every decision branches into the decisions that hang off it.

The **frontier** is every decision whose prerequisites are already settled — the questions you can ask *now* without guessing at answers you have not heard yet.

Work the tree in **rounds**. Ask the whole frontier in one round, numbered, each with **your recommended answer**. Then wait.

A question whose answer depends on another question still open in this round belongs to a *later* round, not this one.

## Round format

```
❓ **P1 — <tytuł pytania>**: <treść, może być kilka akapitów, może zawierać warianty do wyboru>

➡️ <twoja rekomendowana odpowiedź>

---

❓ **P2 — <tytuł pytania>**: <treść>

➡️ <twoja rekomendowana odpowiedź>
```

Always give a recommendation. "Nie wiem, co wolisz" wastes the user's turn — a wrong recommendation they correct in three words is more useful than an open question.

## Facts are your job, decisions are theirs

When a frontier question needs a fact from the environment — how something is currently implemented, which tenants use it, whether a column exists, what a job actually enqueues — **find it yourself**. Dispatch `Explore` or read the code. Never ask the user for anything you could look up.

Do not block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait. Ask the rest of the frontier now.

The **decisions** are the user's. Put each one to them and wait.

## What to grill about

Push hardest where being wrong is expensive:

- **Who feels this and how often** — and what it costs today in manual hours, errors or bad data. A change nobody can quantify is usually smaller than requested.
- **The actual rule, not the example.** The user describes one case; the code needs the rule. Invent edge cases and make them decide — the half-completed case, the already-settled case, the two-people-at-once case.
- **Data and history.** Does this change existing rows, or only new ones? Is a backfill expected? Who owns the data that is wrong today?
- **Permissions.** Who may do this, and what someone without the right should see.
- **Blast radius.** Every user or one segment? Does behaviour already differ per tenant, environment or configuration?
- **Side effects that leave the system** — writes to third parties, money, stock, messages sent. These are the ones that cannot be undone by a revert.
- **What is explicitly out of scope.** The no-s prevent scope creep more reliably than the yes-s.
- **How we will know it worked.** Observable acceptance criteria, in the user's words.

Read `~/.claude/context/<repo-basename>/PROJECT.md` if it exists and add its "Recurring hazards" to the interview — those are the traps this specific project has already been bitten by.

## Finishing

The session is done when the frontier is empty: every branch visited, nothing silently assumed.

Then produce, in Polish:

```text
USTALENIA
- <decyzja 1>
- <decyzja 2>

POZA ZAKRESEM
- <czego świadomie nie robimy>

KRYTERIA AKCEPTACJI
- <obserwowalne zachowanie 1>
- <obserwowalne zachowanie 2>

OTWARTE RYZYKA
- <co nadal nie jest pewne i co z tym zrobimy>
```

If new domain terms were settled or renamed during the interview, call the Skill tool with "domain-model" to record them.

**Do not start implementing until the user confirms the shared understanding.** Hand the block above to `/implement` as the task description.
