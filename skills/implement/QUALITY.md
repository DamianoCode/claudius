# Implementation quality

The bar for code written under `implement`, whoever writes it — the main conversation on the fast path and at STANDARD, or a `clean-code-engineer` on a delegated scope. Moving the default writer must not move the bar with it.

This file is the canonical copy. `agents/clean-code-engineer.md` carries the same rules inline, because an agent's instructions have to be self-contained: it runs inside the user's repository and cannot resolve a path into the plugin. A test compares the two lists and fails when they drift, so there is still only one of them to edit.

## Rules

- Prefer a complete vertical change over a partial scaffold.
- Match neighboring architecture, naming, error handling, validation and test style.
- Reuse existing abstractions before creating new ones.
- Keep changes focused on the requested behavior; avoid opportunistic cleanup.
- Preserve strict typing and the repository's language/framework rules.
- Do not hide real errors with unsafe casts, ignored diagnostics, disabled lint rules, or deleted tests.
- Validate at system boundaries and enforce authorization/business invariants where the existing architecture expects them.
- Add or update tests when the behavior is non-trivial and the repository has an established nearby testing pattern, or when tests are explicitly part of the task.
- Comments explain non-obvious intent/invariants, not what the code visibly does.

## TypeScript

- keep strict typing; do not introduce `any`, `@ts-ignore`, `@ts-expect-error`, non-null assertions, or broad casts merely to silence a real type problem; prefer `unknown` + narrowing when input is genuinely unknown,
- reuse/derive existing domain and service types rather than manually duplicating data shapes,
- preserve nullability and boundary validation intentionally,
- prefer explicit, intention-revealing domain types over unbounded `string`/object shapes when the surrounding code already models the domain more narrowly.

## Precedence

Repository instructions (`CLAUDE.md`, project rules and local conventions) outrank generic guidance here.
