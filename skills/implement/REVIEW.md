# Independent review

## Why the axes are separate

A change can pass one axis and fail another. Code that follows every convention while implementing the wrong thing passes **standards** and fails **spec**; code that does exactly what the ticket asked while breaking the repository's patterns does the reverse. Merging the axes lets one mask the other.

- `AXIS: correctness` — does the code work?
- `AXIS: standards` — is it written the way this repository writes code?
- `AXIS: spec` — does it do what was actually asked for?

## How many reviewers

- **Ordinary work** — one `code-reviewer` with no `AXIS`. It reports all three in separate blocks.
- **High-risk work** — two or three instances **in parallel, in a single message**, one axis each, so neither contaminates the other's context. `correctness` and `spec` are the pair that always earns its cost; add `standards` for sizeable refactors and new modules.

Beyond this, do not spawn reviewer swarms.

## What every reviewer gets

- the original task and acceptance criteria — the `claudius:grill` block verbatim when there was one, `OUT OF SCOPE` included,
- the frozen contract,
- `git diff <BASE_SHA> -- <relevant paths>`,
- the relevant verification results.

Give the `spec` reviewer the spec and **nothing that argues for the implementation**. With no spec it must report `NO SPEC` rather than reconstruct one from the diff — a reconstructed spec only ever confirms whatever was built.

## Handling findings

Aggregate the blocks under their axis headings. **Do not merge or rerank across axes**, and do not name a single worst finding overall — that reranking is exactly what the separation prevents.

- `HIGH` — verify the evidence against the code before fixing.
- `MEDIUM` — fix when credible and within task scope.
- A `spec` scope-creep finding is fixed by **removing** the extra behavior, not by justifying it.
- Advisory ideas become follow-ups, never automatic scope growth.

After review fixes, rerun the affected verification once.
