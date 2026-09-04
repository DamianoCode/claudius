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

import { REPO_ROOT } from './helpers.mjs';

const CANONICAL = join(REPO_ROOT, 'skills', 'implement', 'QUALITY.md');
const AGENT = join(REPO_ROOT, 'agents', 'clean-code-engineer.md');

function read(path) {
  return readFileSync(path, 'utf8');
}

// Bullets under a heading, up to the next heading. Trailing commas and full stops differ
// between a list that ends its items and one that runs them on, so normalise those away
// and compare what the rule actually says.
function bulletsUnder(source, heading, stopAt) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `heading not found: ${heading}`);
  const rest = source.slice(start + heading.length);

  // A section ends at the next heading, or earlier at an explicit marker — the agent file
  // keeps its TypeScript list inside the same numbered section rather than under its own
  // heading, and the two lists must not be compared as one.
  const stops = [rest.search(/\n#{1,6} /), stopAt ? rest.indexOf(stopAt) : -1].filter((i) => i !== -1);
  const section = stops.length === 0 ? rest : rest.slice(0, Math.min(...stops));

  return section
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim().replace(/[.,]$/, ''));
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

test('the orchestrator actually points writers at the canonical rules', () => {
  // The whole point of the split is that the bar follows the code, not the writer. If the
  // spine stops linking QUALITY.md, main-session work silently loses the checklist again.
  const spine = read(join(REPO_ROOT, 'skills', 'implement', 'SKILL.md'));
  assert.match(spine, /\[QUALITY\.md\]\(\.\/QUALITY\.md\)/);
});
