// The severity scale exists in both security agents on purpose, and this keeps it one scale.
//
// The verifier sets the final severity of every serious finding, so it has to judge by the
// same anchors the auditor reported by. Each agent's instructions must stand alone — an agent
// cannot resolve a path into the plugin — so the list is repeated rather than linked, and a
// repeated list that nothing checks is how the verifier quietly starts grading on another curve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, bulletsUnder } from './helpers.mjs';

function severityBullets(agent) {
  return bulletsUnder(readFileSync(join(REPO_ROOT, 'agents', `${agent}.md`), 'utf8'), '\n## Severity\n');
}

test('the auditor and the verifier grade on the same severity scale', () => {
  const auditor = severityBullets('security-auditor');
  assert.ok(auditor.length >= 4, 'the auditor severity list looks truncated');
  assert.deepEqual(severityBullets('security-verifier'), auditor);
});
