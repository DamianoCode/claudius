// A plan run has to stay the same workflow as a manual change. The risk is a second, thinner
// orchestrator growing inside MILESTONES.md, or a plan format the executor no longer reads.
// These tests keep the two skills wired together; they cannot prove a model follows them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers.mjs';

const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8');
const SPINE = read('skills', 'implement', 'SKILL.md');
const MILESTONES = read('skills', 'implement', 'MILESTONES.md');
const PLAN = read('skills', 'plan', 'SKILL.md');
const FORMAT = read('skills', 'plan', 'PLAN-FORMAT.md');

test('implement reaches the plan loop', () => {
  assert.match(SPINE, /\[MILESTONES\.md\]\(\.\/MILESTONES\.md\) \| `\$ARGUMENTS` is `plan <slug>`/);
});

test('the plan loop delegates to the workflow instead of restating it', () => {
  assert.match(MILESTONES, /sections 3 to 6 of \[SKILL\.md\]\(\.\/SKILL\.md\)/);
  assert.match(MILESTONES, /\[REVIEW\.md\]\(\.\/REVIEW\.md\)/);
  // How many reviewers a milestone gets is REVIEW.md's call, not a rule of this file.
  assert.doesNotMatch(MILESTONES, /one per axis|three instances|one `code-reviewer`/);
});

test('both sides link the plan format, and it stays where they point', () => {
  assert.match(MILESTONES, /\(\.\.\/plan\/PLAN-FORMAT\.md\)/);
  assert.match(PLAN, /\(\.\/PLAN-FORMAT\.md\)/);
  assert.ok(existsSync(join(REPO_ROOT, 'skills', 'plan', 'PLAN-FORMAT.md')));
});

test('every milestone key the executor relies on is in the format', () => {
  for (const key of ['main', 'base', 'dirty', 'commits', 'branch', 'tip', 'closing', 'closing-rounds', 'closing-result', 'status', 'checkpoint', 'approved', 'rounds', 'scope', 'start', 'verify', 'point', 'result']) {
    assert.match(FORMAT, new RegExp(`\\n${key}:`), `format lost ${key}`);
    assert.match(MILESTONES, new RegExp(`\`${key}(\`|: )`), `executor ignores ${key}`);
  }
});

test('a plan is bound to its repository before its commands run', () => {
  assert.match(MILESTONES, /`main` differs[^\n]*refuse/);
});

test('plan cannot be fired by the model, and hands off instead of building', () => {
  assert.match(PLAN, /\ndisable-model-invocation: true\n/);
  assert.match(PLAN, /\/claudius:implement plan <slug>/);
  assert.match(PLAN, /\*\*Do not start implementing\.\*\*/);
});

test('a go-ahead and a stop survive the session that gave them', () => {
  // Both used to live only in the conversation: a new session could not tell a checkpoint
  // already passed from one never asked, and a stopped milestone had no way back in.
  assert.match(MILESTONES, /A command being typed is not a go-ahead/);
  assert.match(MILESTONES, /\*\*A stop writes before it speaks\.\*\*/);
  assert.match(FORMAT, /`stopped` → `doing` once the user has answered/);
  assert.match(FORMAT, /the milestone stays `done`/);
});

test('a correction reopens the closing phase too', () => {
  // Otherwise a finished plan with a reopened milestone reports itself finished and never runs it.
  assert.match(FORMAT, /Set `closing: todo` and `closing-rounds: 0`/);
});

test('corrections have one procedure, shared by both skills', () => {
  assert.match(FORMAT, /\n## Applying a correction\n/);
  assert.match(PLAN, /"Applying a correction" in \[PLAN-FORMAT\.md\]/);
  assert.match(MILESTONES, /"Applying a correction" in \[PLAN-FORMAT\.md\]/);
});

test('the permission to commit stays narrow', () => {
  assert.match(SPINE, /`commits` answer is that instruction for its commits and branch, and only those/);
  assert.match(MILESTONES, /no push, no pull request, no amend/);
});
