// Behaviour tests for the workspace: hooks/lib/repo.mjs, the guard and notice hooks,
// and the bin/workspace.mjs CLI, in both modes.
//
// Every test builds a real repository with a bare "origin" beside it, so push state,
// linked worktrees and `git clean` behave exactly as they do on a developer's machine.
// os.homedir() is redirected (see helpers.mjs), so the private overlay is a temp dir too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  REPO_ROOT,
  runHook,
  withTmpDir,
  envWith,
  envWithHome,
  envNoRepoAbove,
  writeOverlay,
} from './helpers.mjs';
import { locateRepo } from '../hooks/lib/repo.mjs';

const CLI = join(REPO_ROOT, 'bin', 'workspace.mjs');

function sh(cwd, cmd, args) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
const git = (cwd, ...args) => sh(cwd, 'git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args]);

// boundary/{home, origin.git, main, main-worktrees} — `main` is a clone with one pushed commit.
function world(boundary, config) {
  const home = join(boundary, 'home');
  const main = join(boundary, 'main');
  mkdirSync(home);
  git(boundary, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(boundary, 'clone', '-q', 'origin.git', 'main');
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n.env.local\n');
  writeFileSync(join(main, 'package.json'), '{}\n');
  mkdirSync(join(main, 'apps'));
  writeFileSync(join(main, 'apps', 'a.js'), '1\n');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  git(main, 'push', '-q', 'origin', 'HEAD:main');

  // No session of the test runner's own Claude Code may leak into a claim.
  const env = envWith(envWithHome(home), envNoRepoAbove(boundary), { CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' });
  if (config) writePool(home, main, { base: 'origin/main', ...config });
  return { home, main, pool: join(boundary, 'main-worktrees'), env };
}

function writePool(home, main, config) {
  const dir = join(home, '.claude', 'context', basename(main));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify(config));
}

function slot(w, args, cwd = w.main, { env = {}, input } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...w.env, ...env }, input, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

const lastLine = (text) => text.split(/\r?\n/).pop();

function denial(result) {
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout.trim() === '') return null;
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, 'deny');
  return output.permissionDecisionReason;
}

// --- locateRepo -------------------------------------------------------------

test('locateRepo names the main tree from the main tree and from a linked worktree', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const linked = join(boundary, 'linked');
    git(w.main, 'worktree', 'add', '-q', '--detach', linked);

    assert.deepEqual(locateRepo(join(w.main, 'apps', 'a.js')), { worktree: w.main, main: w.main, linked: false });
    assert.deepEqual(locateRepo(join(linked, 'apps', 'new-file.js')), { worktree: linked, main: w.main, linked: true });
    assert.equal(locateRepo(join(boundary, 'home')), null);
  });
});

test('context-staleness finds the overlay from a linked worktree', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const linked = join(boundary, 'slot-1');
    git(w.main, 'worktree', 'add', '-q', '--detach', linked);
    writeOverlay(w.home, basename(w.main), Date.now() - 86_400_000 * 3);

    const result = runHook('context-staleness.mjs', { hook_event_name: 'SessionStart', cwd: linked }, { env: w.env });
    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`context/${basename(w.main)}/PROJECT\\.md`));
  });
});

// --- guard-main-tree --------------------------------------------------------

const edit = (file) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } });

test('the guard stays silent in a repository without a pool config', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env })), null);
  });
});

test('the guard refuses a protected main-tree path and names the command to run instead', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { protect: ['apps/'] });
    const reason = denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env }));
    assert.match(reason, /apps\/a\.js/);
    assert.match(reason, /workspace\.mjs" take /);
  });
});

test('the guard lets through unprotected paths, linked worktrees and the explicit override', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { protect: ['apps/'] });
    const linked = join(boundary, 'slot-1');
    git(w.main, 'worktree', 'add', '-q', '--detach', linked);
    const run = (file, env = w.env) => denial(runHook('guard-main-tree.mjs', edit(file), { env }));

    assert.equal(run(join(w.main, 'package.json')), null);
    assert.equal(run(join(w.main, 'apps-notes.md')), null, 'a prefix must match a whole directory name');
    assert.equal(run(join(linked, 'apps', 'a.js')), null);
    assert.equal(run(join(w.main, 'apps', 'a.js'), { ...w.env, CLAUDIUS_ALLOW_MAIN_TREE: '1' }), null);
  });
});

test('a broken pool config never blocks editing', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const dir = join(w.home, '.claude', 'context', basename(w.main));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'workspace.json'), '{ not json');
    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env })), null);
  });
});

// --- workspace-notice ---------------------------------------------------

test('the notice is silent without a pool and speaks once with one', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const bare = world(boundary);
    const silent = runHook('workspace-notice.mjs', { cwd: bare.main }, { env: bare.env });
    assert.equal(silent.stdout, '');

    writePool(bare.home, bare.main, {});
    const spoken = runHook('workspace-notice.mjs', { cwd: bare.main }, { env: bare.env });
    assert.match(spoken.stdout, /^\[workspace\] .*take <branch-name>/);
  });
});

// --- bin/workspace.mjs, worktrees mode ----------------------------------------

test('without a config the CLI leaves the repository alone and names the way to opt in', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const result = slot(w, ['take', 'feat/x']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /keeps its own workflow.*workspace\.mjs init/);
    assert.equal(git(w.main, 'branch', '--show-current'), 'main');
    assert.ok(!existsSync(w.pool));
  });
});

test('take creates a slot on a new branch, copies untracked files and runs prepare steps', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      copy: ['.env.local'],
      prepare: [{ when: ['package.json'], run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    writeFileSync(join(w.main, '.env.local'), 'SECRET=1\n');

    const result = slot(w, ['take', 'feat/x']);
    assert.equal(result.status, 0, result.stderr);
    const path = lastLine(result.stdout);
    assert.equal(path, join(w.pool, 'slot-1'));
    assert.equal(git(path, 'branch', '--show-current'), 'feat/x');
    assert.equal(readFileSync(join(path, '.env.local'), 'utf8'), 'SECRET=1\n');
    assert.equal(readFileSync(marker, 'utf8'), 'x');
  });
});

test('release refuses unpushed work, then a released slot is reused without re-preparing', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      keep: ['node_modules'],
      prepare: [{ when: ['package.json'], run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    mkdirSync(join(path, 'node_modules'));
    writeFileSync(join(path, 'node_modules', 'dep.js'), '');
    writeFileSync(join(path, 'build.tmp'), '');
    writeFileSync(join(path, '.gitignore'), 'node_modules/\n.env.local\nbuild.tmp\n');
    git(path, 'commit', '-qam', 'work');

    const refused = slot(w, ['release'], path);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /unpushed/);

    git(path, 'push', '-q', 'origin', 'feat/a');
    assert.equal(slot(w, ['release'], path).status, 0);

    const again = slot(w, ['take', 'feat/b']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(lastLine(again.stdout), path, 'the free slot is reused rather than a new one made');
    assert.ok(existsSync(join(path, 'node_modules', 'dep.js')), 'kept paths survive the clean');
    assert.ok(!existsSync(join(path, 'build.tmp')), 'leftovers of the previous task are cleaned');
    assert.equal(readFileSync(marker, 'utf8'), 'x', 'unchanged package.json must not re-run its step');
  });
});

test('a claimed slot is never handed out twice, and the pool stops at its size', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { size: 2 });
    assert.equal(lastLine(slot(w, ['take', 'feat/a']).stdout), join(w.pool, 'slot-1'));
    assert.equal(lastLine(slot(w, ['take', 'feat/b']).stdout), join(w.pool, 'slot-2'));

    const full = slot(w, ['take', 'feat/c']);
    assert.equal(full.status, 2);
    assert.match(full.stderr, /All 2 slots are claimed/);
  });
});

test('take checks out an existing remote branch with tracking', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    git(w.main, 'push', '-q', 'origin', 'HEAD:refs/heads/fix/remote-only');
    git(w.main, 'fetch', '-q');
    const path = lastLine(slot(w, ['take', 'fix/remote-only']).stdout);
    assert.equal(git(path, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/fix/remote-only');
  });
});

// --- living inside .claude/worktrees ----------------------------------------

test('by default slots live beside the repository and nothing appears inside it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    assert.equal(path, join(boundary, 'main-worktrees', 'slot-1'));
    assert.equal(git(w.main, 'status', '--porcelain'), '');
    assert.doesNotMatch(readFileSync(join(w.main, '.git', 'info', 'exclude'), 'utf8'), /claudius/);
    assert.match(git(w.main, 'worktree', 'list', '--porcelain'), /locked claudius worktree pool/);
  });
});

test('a pool in .claude/worktrees is hidden from the main tree through the local exclude only', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { pool: '.claude/worktrees' });
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    assert.equal(path, join(w.main, '.claude', 'worktrees', 'slot-1'));

    assert.equal(git(w.main, 'status', '--porcelain'), '', 'the pool must not show up as untracked');
    assert.match(readFileSync(join(w.main, '.git', 'info', 'exclude'), 'utf8'), /^\/\.claude\/worktrees\/$/m);
    assert.equal(git(w.main, 'ls-files', '--others', '--exclude-standard'), '');
    assert.match(git(w.main, 'worktree', 'list', '--porcelain'), /locked claudius worktree pool/);

    slot(w, ['take', 'feat/b']);
    const exclude = readFileSync(join(w.main, '.git', 'info', 'exclude'), 'utf8');
    assert.equal(exclude.match(/\.claude\/worktrees/g).length, 1, 'the exclude entry is added once');
  });
});

test('the claim state survives a git clean of the main tree', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { size: 1 });
    slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDE_PID: String(process.pid) } });
    git(w.main, 'clean', '-fdxq');
    const second = slot(w, ['take', 'feat/b']);
    assert.equal(second.status, 2, 'the slot must still count as claimed');
  });
});

// --- claims and sessions -----------------------------------------------------

function deadPid() {
  return spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
}

test('a slot held by a live session is never handed out, one whose session ended is reclaimed', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { size: 1 });
    slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDE_CODE_SESSION_ID: 'A', CLAUDE_PID: String(process.pid) } });
    assert.equal(slot(w, ['take', 'feat/b']).status, 2);
  });
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { size: 1 });
    slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDE_CODE_SESSION_ID: 'A', CLAUDE_PID: deadPid() } });
    const taken = slot(w, ['take', 'feat/b']);
    assert.equal(taken.status, 0, taken.stderr);
    assert.match(taken.stderr, /Reclaiming slot-1/);
  });
});

test('an orphaned slot with unpushed work is kept, and taking its branch resumes it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { size: 2 });
    const path = lastLine(slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDE_CODE_SESSION_ID: 'A', CLAUDE_PID: deadPid() } }).stdout);
    git(path, 'commit', '-q', '--allow-empty', '-m', 'unpushed');

    const other = lastLine(slot(w, ['take', 'feat/b']).stdout);
    assert.notEqual(other, path, 'unpushed work must not be reclaimed');

    const resumed = slot(w, ['take', 'feat/a']);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(lastLine(resumed.stdout), path);
    assert.match(resumed.stderr, /resuming feat\/a/);
    assert.equal(git(path, 'log', '-1', '--format=%s'), 'unpushed');
  });
});

test('a branch held by another live session is refused rather than shared', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDE_CODE_SESSION_ID: 'A', CLAUDE_PID: String(process.pid) } });
    const result = slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDE_CODE_SESSION_ID: 'B', CLAUDE_PID: String(process.pid) } });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /another live session/);
  });
});

test('session-end frees the ending session\'s safe slots and keeps the rest', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const live = { CLAUDE_CODE_SESSION_ID: 'S', CLAUDE_PID: String(process.pid) };
    const safe = lastLine(slot(w, ['take', 'feat/safe'], w.main, { env: live }).stdout);
    const risky = lastLine(slot(w, ['take', 'feat/risky'], w.main, { env: live }).stdout);
    git(risky, 'commit', '-q', '--allow-empty', '-m', 'unpushed');
    const foreign = lastLine(slot(w, ['take', 'feat/foreign'], w.main, { env: { ...live, CLAUDE_CODE_SESSION_ID: 'T' } }).stdout);

    const ended = slot(w, ['session-end'], w.main, { input: JSON.stringify({ session_id: 'S', cwd: safe }) });
    assert.equal(ended.status, 0);
    assert.equal(ended.stdout, '', 'a SessionEnd hook prints nothing to stdout');

    const claimed = (p) => existsSync(join(w.main, '.git', 'claudius-slots', `${basename(p)}.json`));
    assert.equal(claimed(safe), false);
    assert.equal(claimed(risky), true);
    assert.equal(claimed(foreign), true);
  });
});

test('session-end is silent and succeeds outside a configured repository', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const result = slot(w, ['session-end'], w.main, { input: JSON.stringify({ session_id: 'S', cwd: w.main }) });
    assert.equal(result.status, 0);
    assert.equal(result.stdout + result.stderr, '');
  });
});

test('a worktree that only looks like a slot is never claimed or cleaned', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const lookalike = join(w.pool, 'slot-1');
    mkdirSync(w.pool, { recursive: true });
    git(w.main, 'worktree', 'add', '-q', '-b', 'claude-session', lookalike);
    writeFileSync(join(lookalike, 'work.txt'), "someone else's");
    git(lookalike, 'add', 'work.txt');

    const taken = slot(w, ['take', 'feat/a']);
    assert.equal(taken.status, 2, 'slot-1 is taken by a foreign worktree, so the name cannot be reused');
    assert.ok(existsSync(join(lookalike, 'work.txt')), 'the foreign worktree is untouched');
  });
});

test('a glob in "when" re-runs its step only when a matching file changes', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'generated.log').replaceAll('\\', '/');
    const w = world(boundary, {
      prepare: [{ when: ['schema/*.prisma'], run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    mkdirSync(join(w.main, 'schema'));
    writeFileSync(join(w.main, 'schema', 'a.prisma'), 'model A {}\n');
    git(w.main, 'add', '.');
    git(w.main, 'commit', '-qm', 'schema');
    git(w.main, 'push', '-q', 'origin', 'HEAD:main');

    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    assert.equal(slot(w, ['release'], path).status, 0);
    slot(w, ['take', 'feat/b']);
    assert.equal(readFileSync(marker, 'utf8'), 'x', 'same schema, no second run');

    writeFileSync(join(path, 'schema', 'b.prisma'), 'model B {}\n');
    git(path, 'add', '.');
    git(path, 'commit', '-qm', 'more schema');
    git(path, 'push', '-q', 'origin', 'feat/b');
    assert.equal(slot(w, ['release'], path).status, 0);
    slot(w, ['take', 'feat/b']);
    assert.equal(readFileSync(marker, 'utf8'), 'xx', 'a new schema file re-runs the step');
  });
});

// --- folder names -------------------------------------------------------------

test('the pool folder and the slot prefix are both configurable', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { pool: '../work', prefix: 'wt' });
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    assert.equal(path, join(boundary, 'work', 'wt-1'));
    assert.equal(lastLine(slot(w, ['take', 'feat/b']).stdout), join(boundary, 'work', 'wt-2'));
    assert.equal(slot(w, ['release', 'wt-1']).status, 0);
  });
});

test('a prefix that is not a plain folder name is refused before anything is created', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { prefix: '../escape' });
    const result = slot(w, ['take', 'feat/a']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /plain folder name/);
    assert.ok(!existsSync(w.pool));
  });
});

// --- switching modes ------------------------------------------------------------

test('mode shows the current mode and switches it in the private config', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { protect: ['apps/'] });
    assert.match(slot(w, ['mode']).stderr, /Mode: worktrees/);

    assert.equal(slot(w, ['mode', 'branches']).status, 0);
    const config = JSON.parse(readFileSync(join(w.home, '.claude', 'context', 'main', 'workspace.json'), 'utf8'));
    assert.equal(config.mode, 'branches');
    assert.deepEqual(config.protect, ['apps/'], 'switching keeps the rest of the config');

    assert.equal(slot(w, ['mode', 'sideways']).status, 2);
  });
});

// --- branches mode -------------------------------------------------------------

test('branches mode: take switches the main tree, release returns to the base', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      mode: 'branches',
      prepare: [{ when: ['package.json'], run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });

    const taken = slot(w, ['take', 'feat/a']);
    assert.equal(taken.status, 0, taken.stderr);
    assert.equal(lastLine(taken.stdout), w.main);
    assert.equal(git(w.main, 'branch', '--show-current'), 'feat/a');
    assert.ok(!existsSync(w.pool), 'no worktree is created in branches mode');
    assert.equal(readFileSync(marker, 'utf8'), 'x');

    git(w.main, 'commit', '-q', '--allow-empty', '-m', 'work');
    const refused = slot(w, ['release']);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /unpushed/);

    git(w.main, 'push', '-q', 'origin', 'feat/a');
    assert.equal(slot(w, ['release']).status, 0);
    assert.equal(git(w.main, 'branch', '--show-current'), 'main');
    assert.equal(readFileSync(marker, 'utf8'), 'x', 'unchanged package.json, no second install');
  });
});

test('branches mode refuses to carry uncommitted changes onto another branch', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { mode: 'branches' });
    writeFileSync(join(w.main, 'apps', 'a.js'), 'changed\n');
    const result = slot(w, ['take', 'feat/a']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /uncommitted changes/);
    assert.equal(git(w.main, 'branch', '--show-current'), 'main');
  });
});

test('branches mode guard: refuses edits on a protected branch or detached HEAD, allows them on a work branch', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { mode: 'branches', protect: ['apps/'] });
    const run = () => denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env }));

    assert.match(run(), /on main,.*take <branch-name>/);

    git(w.main, 'switch', '-q', '-c', 'feat/a');
    assert.equal(run(), null);

    git(w.main, 'switch', '-q', '--detach');
    assert.match(run(), /detached HEAD/);
  });
});

test('branches mode guard: protected branches follow the base, or an explicit list', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { mode: 'branches', protect: ['apps/'], base: 'origin/release/*' });
    const run = () => denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env }));

    git(w.main, 'switch', '-q', '-c', 'release/2026-w40');
    assert.match(run(), /release\/2026-w40/);

    writePool(w.home, w.main, { mode: 'branches', protect: ['apps/'], protectedBranches: ['prod'] });
    assert.equal(run(), null, 'an explicit list replaces the defaults');
  });
});

test('the notice names the mode it is in', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { mode: 'branches' });
    const spoken = runHook('workspace-notice.mjs', { cwd: w.main }, { env: w.env });
    assert.match(spoken.stdout, /^\[workspace\] main works on branches in this checkout \(currently main\)/);
  });
});

// --- init ----------------------------------------------------------------------

const configFile = (w) => join(w.home, '.claude', 'context', 'main', 'workspace.json');

function jsRepo(w) {
  writeFileSync(join(w.main, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(w.main, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'libs/*'\n");
  mkdirSync(join(w.main, 'libs'));
  writeFileSync(join(w.main, 'libs', 'x.js'), '1\n');
  git(w.main, 'add', '.');
  git(w.main, 'commit', '-qm', 'monorepo');
  writeFileSync(join(w.main, '.env.local'), 'SECRET=1\n');
}

test('init proposes a config from what the repository contains, and says why', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    jsRepo(w);
    const result = slot(w, ['init']);
    assert.equal(result.status, 0, result.stderr);

    const written = JSON.parse(readFileSync(configFile(w), 'utf8'));
    assert.deepEqual(JSON.parse(result.stdout), written, 'stdout is exactly what was written');
    assert.equal(written.mode, 'worktrees');
    assert.equal(written.pool, '../main-worktrees');
    assert.equal(written.base, 'origin/main');
    assert.deepEqual(written.protect, ['apps/', 'libs/']);
    assert.deepEqual(written.copy, ['.env.local']);
    assert.deepEqual(written.prepare, [{ when: ['pnpm-lock.yaml'], run: 'pnpm install --frozen-lockfile' }]);
    assert.ok(written.keep.includes('node_modules') && written.keep.includes('.env*'));
    assert.match(result.stderr, /protect\s+the workspace folders/);
    assert.equal(git(w.main, 'status', '--porcelain'), '?? .env.local'.replace('?? .env.local', ''), 'init writes nothing into the repository');
  });
});

test('init finds the folder existing worktrees already share', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    git(w.main, 'worktree', 'add', '-q', '--detach', join(boundary, 'mine', 'task-a'));
    git(w.main, 'worktree', 'add', '-q', '--detach', join(boundary, 'mine', 'task-b'));
    const written = JSON.parse(slot(w, ['init', '--dry-run']).stdout);
    assert.equal(written.pool, '../mine');
  });
});

test('init takes the user\'s decisions as flags and drops what a mode does not use', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const result = slot(w, ['init', '--mode', 'branches', '--protect', 'src/, docs/', '--base', 'origin/release/*']);
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(readFileSync(configFile(w), 'utf8'));
    assert.equal(written.mode, 'branches');
    assert.deepEqual(written.protect, ['src/', 'docs/']);
    assert.equal(written.base, 'origin/release/*');
    for (const key of ['pool', 'prefix', 'size', 'keep', 'copy']) assert.ok(!(key in written), `${key} means nothing in branches mode`);
  });
});

test('init never overwrites a config by accident, and --dry-run writes nothing', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    const dry = slot(w, ['init', '--dry-run']);
    assert.equal(dry.status, 0);
    assert.ok(!existsSync(configFile(w)));

    writePool(w.home, w.main, { mode: 'branches', note: 'mine' });
    const again = slot(w, ['init']);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already exists/);
    assert.equal(JSON.parse(readFileSync(configFile(w), 'utf8')).note, 'mine');

    assert.equal(slot(w, ['init', '--force', '--mode', 'worktrees']).status, 0);
    assert.equal(JSON.parse(readFileSync(configFile(w), 'utf8')).mode, 'worktrees');
  });
});

test('init refuses nonsense before writing anything', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    for (const args of [['--mode', 'sideways'], ['--size', '0'], ['--prefix', '../x']]) {
      assert.equal(slot(w, ['init', ...args]).status, 2, args.join(' '));
    }
    assert.ok(!existsSync(configFile(w)));
  });
});

// --- never imposed ---------------------------------------------------------------

test('without a config every hook is silent — the repository keeps its own workflow', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    assert.equal(runHook('workspace-notice.mjs', { cwd: w.main }, { env: w.env }).stdout, '');
    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env })), null);
    const end = slot(w, ['session-end'], w.main, { input: JSON.stringify({ session_id: 'S', cwd: w.main }) });
    assert.equal(end.status, 0);
    assert.equal(end.stdout + end.stderr, '');
  });
});

test('mode off pauses a configured repository without losing its config or slots', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { protect: ['apps/'] });
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    assert.equal(slot(w, ['release'], path).status, 0);
    assert.equal(slot(w, ['mode', 'off']).status, 0);

    assert.equal(runHook('workspace-notice.mjs', { cwd: w.main }, { env: w.env }).stdout, '');
    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env })), null);
    const take = slot(w, ['take', 'feat/b']);
    assert.equal(take.status, 2);
    assert.match(take.stderr, /off for this repository/);
    assert.ok(existsSync(path), 'the slot stays on disk');

    assert.equal(slot(w, ['mode', 'worktrees']).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(configFile(w), 'utf8')).protect, ['apps/']);
    assert.equal(lastLine(slot(w, ['take', 'feat/b']).stdout), path, 'back on, the same warm slot');
  });
});

test('CLAUDIUS_WORKSPACE=off silences everything even where a config exists', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { protect: ['apps/'] });
    const env = { ...w.env, CLAUDIUS_WORKSPACE: 'off' };
    assert.equal(runHook('workspace-notice.mjs', { cwd: w.main }, { env }).stdout, '');
    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env })), null);
    const take = slot(w, ['take', 'feat/a'], w.main, { env: { CLAUDIUS_WORKSPACE: 'off' } });
    assert.equal(take.status, 2);
    assert.match(take.stderr, /switched off/);
    assert.ok(!existsSync(w.pool));
  });
});

test('init proposes release branches as the base when they carry the newest work', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    git(w.main, 'switch', '-q', '-c', 'release/2026-w40');
    git(w.main, 'commit', '-q', '--allow-empty', '-m', 'newer', '--date', '2030-01-01T00:00:00');
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--amend', '--no-edit', '--allow-empty'], {
      cwd: w.main, env: { ...process.env, GIT_COMMITTER_DATE: '2030-01-01T00:00:00' },
    });
    git(w.main, 'push', '-q', 'origin', 'release/2026-w40');
    git(w.main, 'fetch', '-q');
    const result = slot(w, ['init', '--dry-run']);
    assert.equal(JSON.parse(result.stdout).base, 'origin/release/*');
    assert.match(result.stderr, /release branches carry newer work/);
  });
});
