# Implementation quality

The bar for code written under `implement`, whoever writes it — the main conversation on the fast path and at STANDARD, or a `clean-code-engineer` on a delegated scope.

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
- A test must be able to fail: assert observable behavior through the public seam, take the expected value from an independent source rather than recomputing it the way the code does, and see it fail once against the missing or broken behavior.
- Comments explain non-obvious intent/invariants, not what the code visibly does.

## TypeScript

- keep strict typing; do not introduce `any`, `@ts-ignore`, `@ts-expect-error`, non-null assertions, or broad casts merely to silence a real type problem; prefer `unknown` + narrowing when input is genuinely unknown,
- reuse/derive existing domain and service types rather than manually duplicating data shapes,
- preserve nullability and boundary validation intentionally,
- prefer explicit, intention-revealing domain types over unbounded `string`/object shapes when the surrounding code already models the domain more narrowly.

## Self-review

Passing checks say the code runs, not that it is clean. Once the checks have a result and before anyone else sees the work, read what you actually changed as if a stranger had written it: the diff against where you started (`BASE_SHA`, or `HEAD` outside `implement`), leaving out paths that were already dirty, plus every file you created, in full, because `git diff` does not show new files. Not your memory of what you wrote.

- **Trace** — every line you changed traces to the request; anything else of yours comes out, however good an idea it was, and work that was there before you started is never touched.
- **Reuse** — search for an existing helper, type or pattern before keeping anything new; a second way of doing what the repository already does one way goes.
- **Simplicity** — an abstraction, parameter, option or file the task does not need gets inlined; if the same behavior fits in clearly less code, write that.
- **Names** — each new name says what the thing does or holds; a name that will not come honestly means the design is still murky.
- **Leftovers** — no debug output, commented-out code, stray TODOs, unused imports or parameters, and nothing this change left dead.
- **Defensive noise** — no `try`/`catch`, null check or fallback for a state that cannot occur inside the system; handling belongs at the boundary, and a real failure stays visible.
- **Failure paths** — every new branch that can fail does something deliberate; nothing is swallowed, and no message claims what did not happen.
- **Tests** — each new test could fail, and you saw it fail; a test that passes by construction, or mocks the thing under test, is removed or rewritten.
- **Comments** — anything that narrates the code or describes this change rather than the code's intent goes.

One pass. Fix what it finds, rerun the affected check, and put the result in the report: what you fixed, or `clean`. It is a sweep for the things a writer stops seeing, not a licence to rewrite working code or widen the task.

## Precedence

Repository instructions (`CLAUDE.md`, project rules and local conventions) outrank generic guidance here.
