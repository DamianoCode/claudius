# Classification

Choose the workflow by engineering risk, not by file count. The fast path in `SKILL.md` already covers small local work; these tiers describe what is left.

## Risk triggers

The canonical list of risk triggers is the one in [SKILL.md](./SKILL.md), under "Fast path". It does triple duty: hitting a trigger ends the fast path, classifies the change as COMPLEX / HIGH-RISK, and makes review mandatory. Add a new kind of risk **there**, and it takes effect in all three places at once.

Two further conditions call for review without being risks in themselves: a sizeable refactor, and verification that left meaningful uncertainty.

## STANDARD

A normal feature, bug fix or refactor in one coherent area — several files, one owner, one context, no risk trigger hit.

- At most one focused `claudius:Explore`, and only if the important locations and patterns are not already known.
- Implement in the main conversation. A worker earns its keep here only when the detail would flood this context or a second scope can run alongside it.
- Verify after integration.
- Review when the business logic is non-trivial or the diff justifies it.

## COMPLEX / HIGH-RISK

Any risk trigger, or a substantial refactor.

- Reconnaissance first.
- Freeze the relevant contract and the work scopes before any edit.
- One implementation owner where the shared context is strong; parallelize only truly independent scopes.
- Independent final verification is required.
- `code-reviewer` is required, on separate axes.

## PARALLEL

The rules for a parallel wave live here and only here. Two or three implementation workers, and only when **all** hold:

- their write scopes are provably disjoint,
- the shared contract is already frozen,
- parallel execution materially reduces the work.

Then, for the duration of the wave: no orchestrator edits inside an active worker's scope, and `HANDOFF` plus contention files are integrated afterwards, once, by the orchestrator. Contention files are never owned concurrently.

Prefer sequential, shared-context implementation when workers would repeatedly need the same files or the same decisions.

## The rule behind the tiers

Do not create an agent just because a phase exists. Every worker costs a briefing, a report and an integration read; it has to buy more than it costs.
