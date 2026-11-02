# Independent review

## Why the axes are separate

A change can pass one axis and fail another. Code that follows every convention while implementing the wrong thing passes **standards** and fails **spec**; code that does exactly what the ticket asked while breaking the repository's patterns does the reverse. Merging the axes lets one mask the other.

- `AXIS: correctness` — does the code work?
- `AXIS: standards` — is it written the way this repository writes code?
- `AXIS: spec` — does it do what was actually asked for?

## How many reviewers

- **Ordinary work** — one `code-reviewer` with no `AXIS`. It reports all three in separate blocks. This includes a change whose only risk trigger is its size: more than one layer or roughly five files, and nothing else on the list.
- **High-risk work** — any other risk trigger, a sizeable refactor, or verification that left real uncertainty: three instances **in parallel, in a single message**, one per axis, so none contaminates another's context.

No axis is dropped; if a reviewer cannot run, the report says so as a risk. Beyond this, do not spawn reviewer swarms.

## What every reviewer gets

- the original task and acceptance criteria — the `claudius:grill` block verbatim when there was one, `OUT OF SCOPE` included,
- the frozen contract,
- `git diff <BASE_SHA> -- <relevant paths>`, plus the list of untracked paths from `git status --porcelain` — `git diff` does not show new files, and a new file is exactly what must not go unreviewed,
- the relevant verification results.

Give the `spec` reviewer the spec and **nothing that argues for the implementation**. With no spec it must report `NO SPEC` rather than reconstruct one from the diff — a reconstructed spec only ever confirms whatever was built.

## Handling findings

Aggregate the blocks under their axis headings. **Do not merge or rerank across axes**, and do not name a single worst finding overall — that reranking is exactly what the separation prevents.

- `HIGH` — verify the evidence against the code before fixing. For a `correctness` HIGH, the confirmation is a red test at the seam where the defect lives, and that test stays as the regression test; a red `PROBE` tells you where to aim, it does not replace the test. Where no such seam exists, say so and verify against the code.
- `MEDIUM` — fix when credible and within task scope. A judgement-call smell is fixed when the fix is small and stays inside the diff; otherwise it goes in the report as a follow-up with a one-line reason. It does not hold the work open.
- A `spec` scope-creep finding is fixed by **removing** the extra behavior, not by justifying it.
- A finding you checked and found wrong is dropped, with the evidence in the report. A reviewer's report is evidence, not an order.
- Advisory ideas become follow-ups, never automatic scope growth.

## Where the loop ends

Review is a gate, not a conversation. Every extra round reviews the fixes for the last round's findings, and a smell baseline can always find something new in fresh code, so the rounds are bounded here rather than left to judgement.

1. **One round of fixes.** First save `git diff <BASE_SHA>` to a file outside the repository, so the fixes can be told from what was reviewed. Apply them together, not one per finding, then rerun the affected verification once. A fix that breaks verification goes through the repair rounds of section 4, not this limit.
2. **No second review by default.** The fixes are checked by that verification and your own read of their diff.
3. **One exception:** a fix that added behavior or changed a contract, whatever its severity, goes back to the axis that raised it, once. That reviewer gets the original finding, the task and the difference from the saved diff, nothing else.
4. **What is still open then is reported, not iterated.** An unresolved `HIGH` stops the work and goes to the user with the evidence. A new finding on code the change did not touch is a follow-up.
