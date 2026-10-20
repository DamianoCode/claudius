# SECURITY.md format

The running state of security audits for one repository, kept at `~/.claude/context/<repo-basename>/SECURITY.md` — never in the working tree. The main conversation is its only writer; the agents only read what the brief hands them.

Headings and field keys stay in English, because the next run finds its prior state by them. Everything else follows the user's language.

**No secret value ever appears in this file**, not even partly. A secret is recorded by `path:line` and kind.

```markdown
# Security audit — <repo-basename>

## Open findings

### [HIGH] <title>
- ID: access-control/src/api/orders.ts#exportOrders
- FOUND: <YYYY-MM-DD> @ <short sha>
- VERIFIED: security-verifier | main session | unverified
- PRINCIPAL: <who attacks, and what they can already do>
- TRACE: <entry path:line> -> <hop path:line> -> <sink path:line>
- CONTROL: <the control that fails, and why>
- IMPACT: <the concrete result>
- PROBE: <command> -> <result>, or UNPROVEN
- FIX: <smallest source change and its regression test>
- FILES: <every file the finding depends on>

## Needs validation

- <hypothesis> — ID: <id> — TRACE: <path:line hops> — MISSING FACT: <exact fact> — CHECK: <how the owner settles it> — FILES: <paths> — SINCE: <YYYY-MM-DD> @ <short sha>

## Coverage

- <boundary> × <attack classes> — covered | partial — @ <short sha> on <YYYY-MM-DD> — FILES: <paths the conclusion depends on>

## Resolved

- <ID> — <title> — fixed | rejected on re-verification — FIXED IN: <short sha, or none when rejected> — seen @ <run's short sha> on <YYYY-MM-DD>

## Runs

- <YYYY-MM-DD> @ <short sha><, dirty> — <boundaries audited> — <n> findings, <n> needs validation — <auditors> auditor(s), <verifiers> verifier(s)
```

## Rules

- **One entry per `ID`.** A finding found again updates its entry rather than adding a second one.
- **`FILES` come from the auditor** — the trace and the files that hold the controls on it — never only from the trace hops, so that a fix in middleware or policy also counts as a change.
- **Unchanged means none of its `FILES` changed** since the recorded sha: `git diff --quiet <sha> -- <files>` exits 0, `git status --porcelain -- <files>` prints nothing, and every file still exists. Anything else is changed — including a sha git no longer knows (exit 128), and an untracked file, which `git diff` alone does not see.
- **Dirty-tree rule.** On a dirty run, a boundary whose `FILES` are modified or untracked (`git status --porcelain -- <files>` prints anything) gets no coverage entry: what the auditor read is not at the recorded sha, so the next run could not tell it apart from code nobody audited. Findings on such files are still recorded.
- **An unverified `CRITICAL` or `HIGH` carries `VERIFIED: unverified`** and goes back to verification on the next run whether its files changed or not.
- **`FIXED IN`** is the last commit that touched the finding's files since it was recorded: `git log -1 --format=%h <recorded sha>..HEAD -- <files>`. With nothing found, or a fix still uncommitted, write `uncommitted`.
- **Coverage records only what was covered or partly covered.** "Not covered" belongs in the run's report, never in this file — an absent boundary is already not covered.
- **A changed boundary loses its coverage entry** when the next run starts, and a changed open finding goes back through verification.
- **Resolved is a short trail, not an archive.** Keep the last twenty entries; drop the oldest.
- **Runs** likewise keep the last twenty lines.
- Create the file on the first completed run, never as an empty stub.
