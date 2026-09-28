---
name: grill
description: Relentless alignment interview that stress-tests a plan, design or feature request before any code is written. Use when the user says "grill me", "przepytaj mnie", "dopytaj", when a request is large or ambiguous, or before starting COMPLEX / HIGH-RISK work.
disable-model-invocation: true
argument-hint: "[topic]"
---

# Grill

Interview the user until you reach a shared understanding of `$ARGUMENTS`. The most common failure in a codebase is not bad code — it is **building the wrong thing correctly**. This skill exists to make that failure visible before implementation, not after.

Respond in the user's language. The user is the domain expert; you are the one who has to be sure.

## The design tree

Map the work as a **design tree**: every decision branches into the decisions that hang off it.

The **frontier** is every decision whose prerequisites are already settled — the questions you can ask *now* without guessing at answers you have not heard yet.

Work the tree in **rounds**. Ask the whole frontier in one round, then wait. A question whose answer depends on another question still open in this round belongs to a *later* round.

## Ask with the wizard, not with a wall of text

Put each round to the user with the **AskUserQuestion** tool, so they pick instead of typing.

- Up to four questions per round, two to four options each. Free text stays available through "Other".
- **Your recommendation goes first and says so** — mark it `(Recommended)`, translated into the user's language. A wrong recommendation they correct in three words is more useful than an open question.
- Each option's description says what choosing it actually means, including the cost. Options must be genuinely different, not the same answer at three volumes.
- The `header` is a short label, not a sentence.

Fall back to numbered markdown only when a question genuinely cannot fit — more than four real alternatives, or an answer that has to be prose. Never split one decision into two questions just to fit the tool.

When a round would exceed four questions, ask the four that unlock the most and leave the rest to the next round. That is the frontier working as intended, not a compromise.

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
- **Side effects that leave the system** — writes to third parties, money, stock, messages sent. These cannot be undone by a revert.
- **What is explicitly out of scope.** The no-s prevent scope creep more reliably than the yes-s.
- **How we will know it worked.** Observable acceptance criteria, in the user's words.

Read `~/.claude/context/<repo-basename>/PROJECT.md` if it exists and add its "Recurring hazards" to the interview — those are the traps this specific project has already been bitten by.

## Finishing

The session is done when the frontier is empty: every branch visited, nothing silently assumed.

Then produce the block below. **Keep the headings exactly as written, in English**, so `claudius:implement` and `code-reviewer` can find them; write the content in the user's language.

```text
DECISIONS
- <decision 1>
- <decision 2>

OUT OF SCOPE
- <what we are deliberately not doing>

ACCEPTANCE CRITERIA
- <observable behavior 1>
- <observable behavior 2>

OPEN RISKS
- <what is still uncertain, and what we will do about it>
```

If new domain terms were settled or renamed during the interview, call the Skill tool with "claudius:domain-model" to record them (drop the prefix when running this kit standalone).

## Handing off

**Do not start implementing.** `implement` is reserved for explicit user invocation and cannot be called from here — so close the interview by asking the user to run it, and give them the exact line to type:

```
/claudius:implement <task>, per the frozen DECISIONS / OUT OF SCOPE / ACCEPTANCE CRITERIA block above
```

The conversation already carries the block, so they never have to paste it back.
