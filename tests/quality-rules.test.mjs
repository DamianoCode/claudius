// The implementation quality bar exists in two files on purpose, and this is what keeps
// that honest.
//
// skills/implement/QUALITY.md is canonical: the orchestrator reads it before writing code
// itself. agents/clean-code-engineer.md repeats it because an agent's instructions have to
// stand alone — the agent runs inside the user's repository and cannot resolve a path into
// the plugin, so a link there would be a dead reference rather than a shared rule.
//
// Duplication that nothing checks is how two copies quietly stop agreeing, and how moving
// the default writer silently lowers the bar. These tests fail the moment they drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, bulletsUnder } from './helpers.mjs';

const CANONICAL = join(REPO_ROOT, 'skills', 'implement', 'QUALITY.md');
const AGENT = join(REPO_ROOT, 'agents', 'clean-code-engineer.md');

function read(path) {
  return readFileSync(path, 'utf8');
}

test('the quality rules in the agent match the canonical list exactly', () => {
  const canonical = bulletsUnder(read(CANONICAL), '\n## Rules\n');
  const agent = bulletsUnder(read(AGENT), '\n## 3. Implementation quality\n', '\nWhen the project uses TypeScript:');

  assert.ok(canonical.length >= 8, 'the canonical list looks truncated');
  assert.deepEqual(agent, canonical);
});

test('the TypeScript rules in the agent match the canonical list exactly', () => {
  const canonical = bulletsUnder(read(CANONICAL), '\n## TypeScript\n');
  const agent = bulletsUnder(read(AGENT), '\nWhen the project uses TypeScript:\n');

  assert.ok(canonical.length >= 4, 'the canonical TypeScript list looks truncated');
  assert.deepEqual(agent, canonical);
});

test('the self-review in the agent matches the canonical list exactly', () => {
  const canonical = bulletsUnder(read(CANONICAL), '\n## Self-review\n');
  const agent = bulletsUnder(read(AGENT), '\n## 5. Self-review\n');

  assert.ok(canonical.length >= 8, 'the canonical self-review looks truncated');
  assert.deepEqual(agent, canonical);
});

test('the fast path names the self-review inside its own section', () => {
  // It is the only pass fast-path code ever gets. The link has to sit inside the section
  // itself: a link elsewhere in the spine would not stop this path reading as unchecked.
  const spine = read(join(REPO_ROOT, 'skills', 'implement', 'SKILL.md'));
  const fastPath = spine.slice(spine.indexOf('\n## 2. Fast path\n'), spine.indexOf('\n## 3. Classify'));
  assert.match(fastPath, /\[self-review\]\(\.\/QUALITY\.md#self-review\)/);
});

test('review covers every axis, and new files, on every path that reaches it', () => {
  const spine = read(join(REPO_ROOT, 'skills', 'implement', 'SKILL.md'));
  const section = spine.slice(spine.indexOf('\n## 5. Review\n'), spine.indexOf('\n## 6. Final gate'));
  assert.match(section, /Every change that left the fast path gets a `code-reviewer`, on every axis/);

  const review = read(join(REPO_ROOT, 'skills', 'implement', 'REVIEW.md'));
  assert.match(review, /High-risk work\*\* — .*: three instances/);
  assert.match(review, /No axis is dropped/);
  // `git diff` is blind to untracked files, so without this a new module goes unreviewed.
  assert.match(review, /untracked paths/);
  assert.match(review, /\n## Where the loop ends\n/);

  // The count lives in one file; the tiers link to it, and must not grow their own copy.
  const classify = read(join(REPO_ROOT, 'skills', 'implement', 'CLASSIFY.md'));
  assert.doesNotMatch(classify, /one instance/);
  assert.match(classify, /\[REVIEW\.md\]\(\.\/REVIEW\.md\)/);
});

test('the orchestrator actually points writers at the canonical rules', () => {
  // The whole point of the split is that the bar follows the code, not the writer. If the
  // spine stops linking QUALITY.md, main-session work silently loses the checklist again.
  const spine = read(join(REPO_ROOT, 'skills', 'implement', 'SKILL.md'));
  assert.match(spine, /\[QUALITY\.md\]\(\.\/QUALITY\.md\)/);
});

test('diagnose holds its fix to the same canonical rules', () => {
  // A bug fix is still code. Without the link, diagnose fixes escape the bar that every
  // implement change is held to.
  const diagnose = read(join(REPO_ROOT, 'skills', 'diagnose', 'SKILL.md'));
  assert.match(diagnose, /\[QUALITY\.md\]\(\.\.\/implement\/QUALITY\.md\)/);
});
