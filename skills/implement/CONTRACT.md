# Contract, plan and worker briefs

## Freezing a contract

Freeze **only** what must stay consistent between layers or workers. Everything else is an implementation detail and freezing it just creates friction.

```text
CONTRACT
- DTO/types: <exact names/shapes or n/a>
- API/events: <method/path/payload/events or n/a>
- permissions/i18n: <keys or n/a>
- data/schema: <models/fields/relations or n/a>
- invariants: <business rules every implementation must share>

ACCEPTANCE
- <observable behavior 1>
- <observable behavior 2>

WORK
P1 <goal>
   WRITE SCOPE: <paths>
   START FILES: <paths/symbols>
   VERIFY: <targeted checks>
P2 ...
```

When the task came through `claudius:grill`, its `DECISIONS`, `OUT OF SCOPE` and `ACCEPTANCE CRITERIA` blocks **are** the contract and the spec. Do not paraphrase them into something weaker.

## Plan approval

Ask before writing code only when the plan introduces a material decision that was not already explicit in the request — public API or schema shape, auth and permission behavior, destructive data behavior, or a genuinely ambiguous architectural choice.

Ask with the **AskUserQuestion** tool, as options with your recommendation first. Do not create an approval turn for routine implementation.

## Briefing a worker

Give a `clean-code-engineer` enough to succeed without rediscovering the repository:

```text
TASK: <one measurable outcome>
WRITE SCOPE: <exact paths>
START FILES: <best entry points from recon>
CONTRACT: <only the relevant frozen items>
ACCEPTANCE: <the relevant observable criteria>
PATTERN / REUSE: <known analogous paths and helpers>
DO NOT: <task-specific hazards only>
VERIFY SUGGESTION: <narrow check(s)>
```

Do not impose an arbitrary tool-call budget. A few extra reads are far cheaper than a wrong implementation; the brief exists so that *broad* rediscovery is unnecessary, not so that reading is rationed.

For a parallel wave: disjoint scopes, contract already frozen, two or three workers at most, no orchestrator edits inside an active worker's scope, and `HANDOFF` integrated after the wave.

## Integration

After workers finish:

1. Read their `ASSUMPTIONS`, `PUBLIC CONTRACT`, `HANDOFF`, verification and risks.
2. Reconcile every assumption against the contract. Never change another layer to match a worker's accidental deviation.
3. Apply shared and contention-file changes once, yourself.
4. Inspect the combined diff against `BASE_SHA` before the final checks.
5. Look for helpers or contracts that parallel workers created independently of each other.

If a worker stopped early, continue the same agent once — its context is the cheapest thing available, and the `SubagentStop` guard may already have asked for that continuation. If it repeatedly cannot finish, take over or re-scope rather than spawning fresh agents at the same wall.
