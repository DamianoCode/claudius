// Behavior tests for hooks/context-staleness.mjs (SessionStart).
//
// os.homedir() is redirected into a throwaway temp dir via HOME/USERPROFILE in the
// child process env (confirmed to work on Windows — see helpers.mjs) so these tests
// never touch the developer's real ~/.claude/context, and git discovery is fenced
// with GIT_CEILING_DIRECTORIES so a temp dir is never mistaken for a repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, basename } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

import {
  runHook,
  runHookRaw,
  makeTmpDir,
  removeDir,
  envWith,
  envWithHome,
  envNoRepoAbove,
  initGitRepo,
  writeOverlay,
  touch,
} from './helpers.mjs';

const HOOK = 'context-staleness.mjs';

function setup() {
  const boundary = makeTmpDir('claudius-ctx-boundary-');
  const home = join(boundary, 'home');
  const repoDir = join(boundary, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  initGitRepo(repoDir);
  return { boundary, home, repoDir };
}

function teardown(ctx) {
  removeDir(ctx.boundary);
}

test('prints nothing and exits 0 when the overlay does not exist', () => {
  const ctx = setup();
  try {
    const env = envWith(envWithHome(ctx.home), envNoRepoAbove(ctx.boundary));
    const result = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: ctx.repoDir }, { env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    teardown(ctx);
  }
});

test('prints nothing outside a git repository', () => {
  const boundary = makeTmpDir('claudius-ctx-norepo-');
  const home = join(boundary, 'home');
  const notARepo = join(boundary, 'not-a-repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(notARepo, { recursive: true });
  try {
    const env = envWith(envWithHome(home), envNoRepoAbove(boundary));
    const result = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: notARepo }, { env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    removeDir(boundary);
  }
});

test('warns naming package.json when the overlay exists and package.json is newer', () => {
  const ctx = setup();
  try {
    const repoName = basename(ctx.repoDir);
    const oldMtime = Date.now() - 10 * 86_400_000;
    writeOverlay(ctx.home, repoName, oldMtime);

    // package.json written "now", strictly newer than the overlay.
    writeFileSync(join(ctx.repoDir, 'package.json'), '{}\n', 'utf8');
    touch(join(ctx.repoDir, 'package.json'), Date.now());

    const env = envWith(envWithHome(ctx.home), envNoRepoAbove(ctx.boundary));
    const result = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: ctx.repoDir }, { env });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /package\.json/);
    assert.match(result.stdout, /\[context\]/);
  } finally {
    teardown(ctx);
  }
});

test('prints nothing when the overlay is newer than every source file', () => {
  const ctx = setup();
  try {
    const repoName = basename(ctx.repoDir);

    const oldMtime = Date.now() - 10 * 86_400_000;
    writeFileSync(join(ctx.repoDir, 'package.json'), '{}\n', 'utf8');
    touch(join(ctx.repoDir, 'package.json'), oldMtime);

    // Overlay written after (and therefore newer than) the source file above.
    writeOverlay(ctx.home, repoName, Date.now());

    const env = envWith(envWithHome(ctx.home), envNoRepoAbove(ctx.boundary));
    const result = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: ctx.repoDir }, { env });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    teardown(ctx);
  }
});

// --- input hygiene ---

test('exits 0 for malformed JSON on stdin by falling back to the process cwd', () => {
  const ctx = setup();
  try {
    const env = envWith(envWithHome(ctx.home), envNoRepoAbove(ctx.boundary));
    // cwd of the child process itself is the non-repo boundary dir, so the fallback
    // path (process.cwd()) also resolves to "not a repository".
    const result = runHookRaw(HOOK, '{not valid json', { env, cwd: ctx.boundary });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    teardown(ctx);
  }
});

test('exits 0 for empty stdin', () => {
  const ctx = setup();
  try {
    const env = envWith(envWithHome(ctx.home), envNoRepoAbove(ctx.boundary));
    const result = runHookRaw(HOOK, '', { env, cwd: ctx.boundary });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    teardown(ctx);
  }
});

test('exits 0 for an event it does not gate on (hook has no event-name check, but must stay silent without an overlay)', () => {
  const ctx = setup();
  try {
    const env = envWith(envWithHome(ctx.home), envNoRepoAbove(ctx.boundary));
    const result = runHook(HOOK, { hook_event_name: 'PostToolUse', cwd: ctx.repoDir }, { env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    teardown(ctx);
  }
});
