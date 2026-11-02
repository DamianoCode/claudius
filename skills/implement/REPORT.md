# Final report

Write it **as markdown, not inside a code fence** — fenced text renders as inert monospace and kills the clickable `path:line` references. Write it in the user's language.

Build `CHANGED` from the git output, never from memory of what a worker said it did. Use `--numstat` for untruncated paths and exact `+a/-b`, and `--name-status` for the add/modify/delete/rename marker. Never plain `--stat`: it abbreviates long paths to `.../name.ts`.

## Default shape — three sections

Most changes need exactly this. **A section with nothing material in it is not printed** — an empty "Risks: none" heading is noise, not reassurance.

**What changed** — one bullet per file, grouped by area when there are many. Mark each `new` / `mod` / `del` / `ren`, give its `+a/-b`, and point at the key symbol with `path:line`. Say what the file now does differently, not that it was edited.

> **<area>**
> - `mod` `<path>:<line>` (+38/-6) — `<symbol>()` now rejects <case> instead of <old behavior>.
> - `new` `<path>` (+21/-0) — <what this file is for>.

Close with `TOTAL: <n> files, +<a>/-<b>`.

**Behavior** — one or two sentences: what a user could not do before and can now, or what was broken and is now correct. If the change is invisible to users, say so plainly.

**Verification** — every command actually run, each with `PASS` / `FAIL` / `BLOCKED` and the reason for anything not green. Never list a command you did not run. End with the self-review result: what it fixed, or `clean`.

Beyond the fast path a fourth section is always there:

**Review** — one line per axis: `OK`, `findings fixed — <count>`, `dropped — <evidence>`, or the unresolved findings themselves. Name the reason when a reviewer could not run.

## Sections that appear only when they carry something

- **Manual steps** — migrations, env vars, deploy actions, backfills.
- **Risks / follow-ups** — material items, plus judgement-call smells left unfixed.
- **Commit suggestion** — `type(scope): message` per the repository's convention, with a plain statement that nothing has been committed. A plan that committed lists its commit range instead. Include it whenever the change is worth committing.

Offer the full breakdown in one line if you left sections out, so the user can ask for it without guessing that more exists.

## Scale

Fast-path work gets three lines: what changed, what behaves differently, whether the check passed; then the self-review result: what it fixed, or `clean`. A self-review that left no trace cannot be told from one that never ran. A one-line fix does not need headings — the commit suggestion still comes along when the change is worth committing.

Beyond roughly fifteen changed files, group bullets by area, list individual files only where a reviewer needs to look, and summarize the rest as `<n> further files — <what they have in common>`.

## Do not

Do not pad the report with files you did not touch, restate the task description back at the user, or narrate the process — which agents ran, what was searched, how many rounds it took. The user wants the resulting change, not the transcript.
