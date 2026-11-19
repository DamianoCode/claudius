// Behaviour tests for the workspace: hooks/lib/repo.mjs, the guard and notice hooks,
// and the bin/workspace.mjs CLI, in both modes.
//
// Every test builds a real repository with a bare "origin" beside it, so push state,
// linked worktrees and `git clean` behave exactly as they do on a developer's machine.
// os.homedir() is redirected (see helpers.mjs), so the private overlay is a temp dir too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

import {
  REPO_ROOT,
  runHook,
  withTmpDir,
  envWith,
  envWithHome,
  envNoRepoAbove,
  writeOverlay,
} from './helpers.mjs';
import { canonical, locateRepo } from '../hooks/lib/repo.mjs';

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
  // Nor may the runner's own Orca session decide what "auto" means.
  const env = envWith(envWithHome(home), envNoRepoAbove(boundary), {
    CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', CLAUDE_CODE_ENTRYPOINT: '', ORCA_AGENT_SESSION_ID: '',
  });
  if (config) writePool(home, main, { base: 'origin/main', ...config });
  return { home, main, pool: join(boundary, 'main-worktrees'), env };
}

// Bound to `main` unless the config says otherwise; `main: undefined` writes a config from
// before the binding.
function writePool(home, main, config) {
  const dir = join(home, '.claude', 'context', basename(main));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ main: canonical(main), ...config }));
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

test("the notice tells a slot from another tool's worktree", () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const slotPath = lastLine(slot(w, ['take', 'feat/a']).stdout);
    const foreign = join(boundary, 'ide-task');
    git(w.main, 'worktree', 'add', '-q', '-b', 'feat/ide', foreign, 'origin/main');

    assert.match(runHook('workspace-notice.mjs', { cwd: slotPath }, { env: w.env }).stdout, /free it with: .*release/);
    const spoken = runHook('workspace-notice.mjs', { cwd: foreign }, { env: w.env }).stdout;
    assert.match(spoken, /ide-task of main, which is not a slot/);
    assert.doesNotMatch(spoken, /release/);
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

test('a slot that lost its pool lock is still a slot, and take locks it again', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    assert.equal(slot(w, ['release'], path).status, 0);
    git(w.main, 'worktree', 'unlock', path);

    const again = slot(w, ['take', 'feat/b']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(lastLine(again.stdout), path);
    assert.match(again.stderr, /slot-1 had lost its pool lock/);
    assert.match(git(w.main, 'worktree', 'list', '--porcelain'), /locked claudius worktree pool/);
  });
});

test('a worktree in the pool locked for another reason is never taken as a slot', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const path = join(w.pool, 'slot-1');
    git(w.main, 'worktree', 'add', '-q', '--detach', path);
    git(w.main, 'worktree', 'lock', '--reason', 'claude session x (pid 1)', path);

    const result = slot(w, ['take', 'feat/a']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /locked by something else \(claude session x/);
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

test('a pool inside the tree that passes through a link is refused, however the pool is spelled', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    // A junction stands in for a tracked symlink: Windows hands those out only with a
    // privilege, and both resolve the same way.
    mkdirSync(join(w.main, '.claude'));
    symlinkSync(join(w.main, 'apps'), join(w.main, '.claude', 'worktrees'), 'junction');
    // The user's own alias of the checkout — a symlinked ~/code, a subst drive.
    const alias = join(boundary, 'alias');
    symlinkSync(w.main, alias, 'junction');
    const exclude = join(w.main, '.git', 'info', 'exclude');
    const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';

    for (const pool of ['.claude/worktrees', join(alias, '.claude', 'worktrees'), '../alias/.claude/worktrees']) {
      writePool(w.home, w.main, { base: 'origin/main', pool });
      const refused = slot(w, ['take', 'feat/a']);
      assert.equal(refused.status, 2, `${pool}: ${refused.stderr}`);
      assert.match(refused.stderr, /passes through \.claude[\\/]worktrees, which is a link/);
    }
    assert.ok(!existsSync(join(w.main, 'apps', 'slot-1')), 'no slot where the link points');
    assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before, 'nothing hidden from git status');
  });
});

test('prepare steps never run a command the branch put in the slot folder', { skip: process.platform !== 'win32' }, () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'shim-ran.log');
    const w = world(boundary, { prepare: [{ run: 'claudius-probe-tool --version' }] });
    // As in the user's own terminal; Claude Code's tools set this variable themselves.
    for (const key of Object.keys(w.env)) if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete w.env[key];
    writeFileSync(join(w.main, 'claudius-probe-tool.cmd'), `@echo shim> "${marker}"\r\n`);
    git(w.main, 'add', '.');
    git(w.main, 'commit', '-qm', 'a tool of the branch');
    git(w.main, 'push', '-q', 'origin', 'HEAD:main');

    slot(w, ['take', 'feat/a']);
    assert.ok(!existsSync(marker), 'the tracked claudius-probe-tool.cmd must not run');
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
    assert.match(taken.stderr, /without the pool's lock or mark/);
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

// --- path spelling ----------------------------------------------------------------

// Windows can hand the same folder out as an 8.3 short path (C:\Users\RUNNER~1\…); git
// always reports the long one. Everything that compares paths must agree on a spelling.
function shortPath(longPath) {
  // Through the environment, so no quoting layer between Node and the shell can mangle it.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:CLAUDIUS_LONG_PATH).ShortPath'], {
    encoding: 'utf8', env: { ...process.env, CLAUDIUS_LONG_PATH: longPath },
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : longPath;
}

test('slots are recognised when the repository is reached through a short 8.3 path', { skip: process.platform !== 'win32' }, (t) => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { size: 1 });
    const longRoot = join(boundary, 'a-directory-name-long-enough-for-8dot3');
    mkdirSync(longRoot);
    const short = shortPath(longRoot);
    if (short.toLowerCase() === longRoot.toLowerCase()) {
      t.skip('8.3 names are disabled on this volume');
      return;
    }
    // The repository lives under the long-named folder; every command reaches it by the short name.
    const repo = join(longRoot, 'main');
    git(w.main, 'clone', '-q', join(boundary, 'origin.git'), repo);
    writePool(w.home, repo, { base: 'origin/main', size: 1 });
    const viaShort = join(short, 'main');

    const first = slot(w, ['take', 'feat/a'], viaShort);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(lastLine(first.stdout), join(longRoot, 'main-worktrees', 'slot-1'), 'reported in the long form git uses');

    const second = slot(w, ['take', 'feat/b'], viaShort);
    assert.equal(second.status, 2, 'the claimed slot must be recognised as a slot, not ignored');
    assert.match(second.stderr, /All 1 slots are claimed/);

    assert.equal(slot(w, ['release', 'slot-1'], viaShort).status, 0);
  });
});

// --- a config belongs to one repository ----------------------------------------

// The overlay folder is named after the main tree's basename, and a cloned repository picks
// its own name — so "main" in the config, not the folder, decides whose config it is.
function namesake(boundary) {
  const other = join(boundary, 'clones', 'main');
  mkdirSync(join(boundary, 'clones'));
  git(join(boundary, 'clones'), 'init', '-q', '-b', 'main', 'main');
  writeFileSync(join(other, 'package.json'), '{}\n');
  mkdirSync(join(other, 'apps'));
  writeFileSync(join(other, 'apps', 'a.js'), '1\n');
  git(other, 'add', '.');
  git(other, 'commit', '-qm', 'theirs');
  return other;
}

test('a repository that only shares the folder name never runs another repository\'s config', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      protect: ['apps/'],
      prepare: [{ run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    const other = namesake(boundary);

    const refused = slot(w, ['take', 'feat/x'], other);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /belongs to .*not to this repository/);
    assert.ok(!existsSync(marker), 'no prepare step may run');
    assert.ok(!existsSync(join(boundary, 'clones', 'main-worktrees')));

    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(other, 'apps', 'a.js')), { env: w.env })), null);
    assert.equal(runHook('workspace-notice.mjs', { cwd: other }, { env: w.env }).stdout, '');

    // The owner is unaffected.
    assert.equal(slot(w, ['take', 'feat/x']).status, 0);
    assert.equal(readFileSync(marker, 'utf8'), 'x');
  });
});

test('a config from before the binding is ignored, and the line it asks for binds it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { main: undefined, base: 'origin/main', protect: ['apps/'] });
    const line = `"main": ${JSON.stringify(canonical(w.main))}`;

    const refused = slot(w, ['take', 'feat/x']);
    assert.equal(refused.status, 2);
    assert.ok(refused.stderr.includes(line), refused.stderr);
    assert.ok(!existsSync(w.pool));

    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env })), null);
    const notice = runHook('workspace-notice.mjs', { cwd: w.main }, { env: w.env });
    assert.ok(notice.stdout.includes(line), notice.stdout);

    // Exactly what the message says to add, pasted into the file by hand.
    writeFileSync(configFile(w), readFileSync(configFile(w), 'utf8').replace('{', `{${line},`));
    assert.equal(slot(w, ['take', 'feat/x']).status, 0);
    assert.notEqual(denial(runHook('guard-main-tree.mjs', edit(join(w.main, 'apps', 'a.js')), { env: w.env })), null);
  });
});

test('a config whose repository moved away says how to bind it to the new place', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { main: join(boundary, 'moved-from', 'main') });
    const refused = slot(w, ['status']);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /no longer exists/);
    assert.ok(refused.stderr.includes(`"main": ${JSON.stringify(canonical(w.main))}`), refused.stderr);
  });
});

test('init binds the config it writes to this repository', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary);
    assert.equal(slot(w, ['init']).status, 0);
    assert.equal(JSON.parse(readFileSync(configFile(w), 'utf8')).main, canonical(w.main));
    assert.equal(slot(w, ['take', 'feat/x']).status, 0);
  });
});

// --- sweep ----------------------------------------------------------------------

// gh is spawned without a shell, so its stand-in must be an executable named gh: a copy of
// node with a preload on Windows, where only gh.exe is found, and a script elsewhere.
function fakeGh(dir, env, prs) {
  const bin = join(dir, 'fake-bin');
  mkdirSync(bin);
  const json = join(dir, 'prs.json');
  writeFileSync(json, JSON.stringify(prs));
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const path = { [pathKey]: `${bin}${delimiter}${env[pathKey] ?? ''}` };
  if (process.platform !== 'win32') {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat '${json}'\n`, { mode: 0o755 });
    return path;
  }
  copyFileSync(process.execPath, join(bin, 'gh.exe'));
  const preload = join(dir, 'fake-gh.cjs').replaceAll('\\', '/');
  writeFileSync(preload, [
    "if (require('path').basename(process.execPath).toLowerCase() === 'gh.exe') {",
    `  process.stdout.write(require('fs').readFileSync(${JSON.stringify(json)}, 'utf8'));`,
    '  process.exit(0);',
    '}',
    '',
  ].join('\n'));
  return { ...path, NODE_OPTIONS: `--require "${preload}"` };
}

test('sweep frees only the slots a merged pull request of this repository actually contained', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const claimed = (branch) => {
      const path = lastLine(slot(w, ['take', branch]).stdout);
      writeFileSync(join(path, `${basename(branch)}.txt`), branch);
      git(path, 'add', '.');
      git(path, 'commit', '-qm', branch);
      git(path, 'push', '-q', '-u', 'origin', branch);
      return path;
    };
    const fork = claimed('develop');
    const done = claimed('feat/done');
    const reused = claimed('feat/reused');
    const reusedHead = git(reused, 'rev-parse', 'HEAD');
    writeFileSync(join(reused, 'more.txt'), 'after the merge');
    git(reused, 'add', '.');
    git(reused, 'commit', '-qm', 'after the merge');
    git(reused, 'push', '-q', 'origin', 'feat/reused');
    // The PR head is one commit past the local branch — merged on GitHub after a review fix.
    const behind = claimed('feat/behind');
    writeFileSync(join(behind, 'review.txt'), 'fixed in review');
    git(behind, 'add', '.');
    git(behind, 'commit', '-qm', 'review fix');
    git(behind, 'push', '-q', 'origin', 'feat/behind');
    const behindHead = git(behind, 'rev-parse', 'HEAD');
    git(behind, 'reset', '-q', '--hard', 'HEAD~1');
    const unfetched = claimed('feat/unfetched');

    const gh = fakeGh(boundary, w.env, [
      { headRefName: 'develop', headRefOid: git(fork, 'rev-parse', 'HEAD'), isCrossRepository: true, number: 7, state: 'MERGED' },
      { headRefName: 'feat/done', headRefOid: git(done, 'rev-parse', 'HEAD'), isCrossRepository: false, number: 8, state: 'MERGED' },
      { headRefName: 'feat/reused', headRefOid: reusedHead, isCrossRepository: false, number: 9, state: 'MERGED' },
      { headRefName: 'feat/behind', headRefOid: behindHead, isCrossRepository: false, number: 10, state: 'MERGED' },
      { headRefName: 'feat/unfetched', headRefOid: '1'.repeat(40), isCrossRepository: false, number: 11, state: 'MERGED' },
    ]);
    const result = slot(w, ['sweep', '--yes'], w.main, { env: gh });
    assert.equal(result.status, 0, result.stderr);

    const onBranch = (path) => git(path, 'branch', '--show-current');
    assert.equal(onBranch(done), '', 'the merged branch of this repository is swept');
    assert.equal(onBranch(fork), 'develop', "a fork's pull request says nothing about a local branch");
    assert.equal(onBranch(reused), 'feat/reused', 'commits after the merge keep the slot');
    assert.match(result.stderr, /SKIP .*feat\/reused.*did not contain/);
    assert.equal(onBranch(behind), '', 'a branch the PR head contains is swept too');
    assert.equal(onBranch(unfetched), 'feat/unfetched', 'a head this clone does not have covers nothing');
    assert.match(result.stderr, /SKIP .*feat\/unfetched.*git fetch origin/);
    const branches = git(w.main, 'branch', '--format=%(refname:short)').split(/\r?\n/);
    assert.ok(!branches.includes('feat/done') && !branches.includes('feat/behind'));
    assert.ok(['develop', 'feat/reused', 'feat/unfetched'].every((branch) => branches.includes(branch)));
  });
});

test("sweep leaves another tool's worktree in place and names the ones whose folder is gone", () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const other = (branch) => {
      const path = join(boundary, branch.replace('/', '-'));
      git(w.main, 'worktree', 'add', '-q', '-b', branch, path, 'origin/main');
      writeFileSync(join(path, 'x.txt'), branch);
      git(path, 'add', '.');
      git(path, 'commit', '-qm', branch);
      git(path, 'push', '-q', 'origin', branch);
      return path;
    };
    const ide = other('feat/ide');
    const gone = other('feat/gone');
    rmSync(gone, { recursive: true, force: true });

    const gh = fakeGh(boundary, w.env, [
      { headRefName: 'feat/ide', headRefOid: git(ide, 'rev-parse', 'HEAD'), isCrossRepository: false, number: 8, state: 'MERGED' },
    ]);
    const dry = slot(w, ['sweep'], w.main, { env: gh });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stderr, /LEAVE feat-ide .*not a slot/);
    assert.match(dry.stderr, /GONE feat-gone .*git worktree prune/);

    const result = slot(w, ['sweep', '--yes'], w.main, { env: gh });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(ide, 'x.txt')), 'a worktree the pool did not make is never removed');
    assert.ok(git(w.main, 'branch', '--format=%(refname:short)').split(/\r?\n/).includes('feat/ide'));
    assert.ok(!git(w.main, 'worktree', 'list').includes('feat-gone'), 'the entry of a deleted folder is pruned');
  });
});

test('status lists a worktree whose folder is gone instead of failing on it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    const gone = join(boundary, 'gone');
    git(w.main, 'worktree', 'add', '-q', '-b', 'feat/gone', gone, 'origin/main');
    rmSync(gone, { recursive: true, force: true });
    const result = slot(w, ['status'], w.main, { env: fakeGh(boundary, w.env, []) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /\(gone\).*missing/);
    assert.match(slot(w, ['take', 'feat/gone']).stderr, /folder is gone.*git worktree prune/);
  });
});

// --- copy ---------------------------------------------------------------------------

test('copy never follows a folder link in the slot out of it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { copy: ['cfg/.env.local'], keep: ['cfg'] });
    mkdirSync(join(w.main, 'cfg'));
    writeFileSync(join(w.main, 'cfg', '.env.local'), 'SECRET=1\n');
    // Shared by every worktree, so the link below leaves the slot clean enough to release.
    writeFileSync(join(w.main, '.git', 'info', 'exclude'), 'cfg\n');

    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    const outside = join(boundary, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(path, 'cfg'), 'junction');
    assert.equal(slot(w, ['release'], path).status, 0);

    const again = slot(w, ['take', 'feat/b']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(lastLine(again.stdout), path);
    assert.ok(!existsSync(join(outside, '.env.local')), 'the secret must not land outside the slot');
    assert.match(again.stderr, /skipped cfg[\\/]\.env\.local/);
  });
});

test('copy never writes through a target that is itself a link, even a dangling one', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { copy: ['.env.local'], keep: ['.env.local'] });
    writeFileSync(join(w.main, '.env.local'), 'SECRET=1\n');
    const path = lastLine(slot(w, ['take', 'feat/a']).stdout);
    rmSync(join(path, '.env.local'));
    const outside = join(boundary, 'outside');
    mkdirSync(outside);
    // A junction stands in for a file link: Windows hands those out only with a privilege.
    symlinkSync(join(outside, 'gone'), join(path, '.env.local'), 'junction');
    assert.equal(slot(w, ['release'], path).status, 0);

    assert.equal(slot(w, ['take', 'feat/b']).status, 0);
    assert.ok(!existsSync(join(outside, 'gone')), 'nothing may be created where the link points');
  });
});

// --- provider: Orca ---------------------------------------------------------------

// A stand-in for Orca's CLI with the behaviour take relies on, as the real one shows it:
// `worktree create` makes a worktree under FAKE_ORCA_BASE without an upstream and starts a
// suffixed branch from the base when the branch it is given already exists; `list` returns
// every worktree of the repository, and only the ones it created carry a creatorProvenance.
const FAKE_ORCA = String.raw`
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const args = global.FAKE_ARGS ?? process.argv.slice(2);
const opt = (name) => args[args.indexOf(name) + 1];
const base = fs.realpathSync.native(process.env.FAKE_ORCA_BASE);
fs.appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(args) + '\n');
const git = (...a) => execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }).trim();
const out = (result) => { process.stdout.write(JSON.stringify({ ok: true, result })); process.exit(0); };
if (args[0] === 'worktree' && args[1] === 'create') {
  let folder = path.join(base, opt('--name'));
  if (fs.existsSync(folder)) folder += '-2';
  let branch = opt('--branch');
  try { git('show-ref', '--verify', '--quiet', 'refs/heads/' + branch); branch += '-2'; } catch {}
  git('worktree', 'add', '-q', '--no-track', '-b', branch, folder, opt('--base-branch'));
  fs.appendFileSync(process.env.FAKE_ORCA_LOG + '.made', fs.realpathSync.native(folder) + '\n');
  out({ worktree: { path: folder.split(path.sep).join('/'), branch: 'refs/heads/' + branch } });
}
if (args[0] === 'worktree' && args[1] === 'list') {
  const made = fs.existsSync(process.env.FAKE_ORCA_LOG + '.made')
    ? fs.readFileSync(process.env.FAKE_ORCA_LOG + '.made', 'utf8').split('\n').filter(Boolean) : [];
  const paths = git('worktree', 'list', '--porcelain').split(/\r?\n/)
    .filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9));
  const ours = (p) => fs.existsSync(p) && made.includes(fs.realpathSync.native(p));
  out({ worktrees: paths.map((p, i) => ({
    path: p, isMainWorktree: i === 0, creatorProvenance: ours(p) ? { kind: 'host' } : false,
  })) });
}
if (args[0] === 'worktree' && args[1] === 'rm') {
  git('worktree', 'remove', opt('--worktree').slice('path:'.length));
  out({});
}
process.stdout.write(JSON.stringify({ ok: false, error: { message: 'fake orca: unknown ' + args.join(' ') } }));
process.exit(1);
`;

const FAKE_GH = String.raw`
const fs = require('fs');
process.stdout.write(fs.readFileSync(process.env.FAKE_GH_PRS, 'utf8'));
process.exit(0);
`;

// gh and orca stand-ins in one folder on PATH: scripts elsewhere, copies of node with one
// preload on Windows (see fakeGh). There node takes the first argument for a script path
// and resolves it, so the preload hands the script its arguments before node gets to them.
function fakeTools(dir, env, prs = []) {
  const bin = join(dir, 'fake-tools');
  mkdirSync(bin);
  const base = join(dir, 'orca-workspaces');
  mkdirSync(base);
  const log = join(dir, 'orca.log');
  writeFileSync(log, '');
  const prsFile = join(dir, 'prs.json');
  writeFileSync(prsFile, JSON.stringify(prs));
  const scripts = {};
  for (const [name, source] of Object.entries({ orca: FAKE_ORCA, gh: FAKE_GH })) {
    scripts[name] = join(dir, `fake-${name}.cjs`);
    writeFileSync(scripts[name], source);
  }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const extra = { [pathKey]: `${bin}${delimiter}${env[pathKey] ?? ''}`, FAKE_ORCA_BASE: base, FAKE_ORCA_LOG: log, FAKE_GH_PRS: prsFile };
  if (process.platform !== 'win32') {
    for (const [name, script] of Object.entries(scripts)) {
      writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
    }
    return { env: extra, base, log };
  }
  const byExe = {};
  for (const [name, script] of Object.entries(scripts)) {
    copyFileSync(process.execPath, join(bin, `${name}.exe`));
    byExe[`${name}.exe`] = script;
  }
  const preload = join(dir, 'fake-tools.cjs').replaceAll('\\', '/');
  writeFileSync(preload, [
    "const path = require('path');",
    `const script = ${JSON.stringify(byExe)}[path.basename(process.execPath).toLowerCase()];`,
    'if (script) {',
    '  global.FAKE_ARGS = process.argv.length > 1 ? [path.basename(process.argv[1]), ...process.argv.slice(2)] : [];',
    '  require(script);',
    '}',
    '',
  ].join('\n'));
  return { env: { ...extra, NODE_OPTIONS: `--require "${preload}"` }, base, log };
}

const orcaCalls = (tools) => readFileSync(tools.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('provider orca: take creates the worktree through Orca from the base, prepares it, and resumes it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      provider: 'orca',
      orca: { repo: 'name:Main' },
      copy: ['.env.local'],
      prepare: [{ when: ['package.json'], run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    writeFileSync(join(w.main, '.env.local'), 'SECRET=1\n');
    const tools = fakeTools(boundary, w.env);

    const result = slot(w, ['take', 'feat/it-1181-gabaryty-skrytek'], w.main, { env: tools.env });
    assert.equal(result.status, 0, result.stderr);
    const path = lastLine(result.stdout);
    assert.equal(canonical(path), canonical(join(tools.base, 'it-1181-gabaryty-skrytek')), 'the folder drops the type prefix');
    assert.equal(git(path, 'branch', '--show-current'), 'feat/it-1181-gabaryty-skrytek');
    assert.equal(readFileSync(join(path, '.env.local'), 'utf8'), 'SECRET=1\n');
    assert.equal(readFileSync(marker, 'utf8'), 'x');
    assert.ok(!existsSync(w.pool), 'no pool slot is made');

    const [create] = orcaCalls(tools);
    assert.deepEqual(create.slice(0, 2), ['worktree', 'create']);
    for (const [flag, value] of [['--repo', 'name:Main'], ['--base-branch', 'origin/main'], ['--setup', 'skip']]) {
      assert.equal(create[create.indexOf(flag) + 1], value, flag);
    }

    const again = slot(w, ['take', 'feat/it-1181-gabaryty-skrytek'], w.main, { env: tools.env });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(lastLine(again.stdout), path);
    assert.match(again.stderr, /resuming/);
    assert.equal(orcaCalls(tools).filter((call) => call[1] === 'create').length, 1, 'resuming creates nothing');
    assert.equal(readFileSync(marker, 'utf8'), 'x', 'an unchanged lockfile is not prepared twice');
  });
});

test('provider orca: an existing branch is reopened as it is, not started again under a suffix', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'orca' });
    git(w.main, 'switch', '-q', '-c', 'feat/review');
    writeFileSync(join(w.main, 'review.txt'), 'work under review');
    git(w.main, 'add', '.');
    git(w.main, 'commit', '-qm', 'review');
    git(w.main, 'push', '-q', 'origin', 'feat/review');
    const head = git(w.main, 'rev-parse', 'HEAD');
    git(w.main, 'switch', '-q', 'main');
    git(w.main, 'branch', '-q', '-D', 'feat/review');
    const tools = fakeTools(boundary, w.env);

    const result = slot(w, ['take', 'feat/review'], w.main, { env: tools.env });
    assert.equal(result.status, 0, result.stderr);
    const path = lastLine(result.stdout);
    assert.equal(git(path, 'branch', '--show-current'), 'feat/review');
    assert.equal(git(path, 'rev-parse', 'HEAD'), head);
    assert.equal(git(path, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/feat/review');
    const branches = git(w.main, 'branch', '--format=%(refname:short)').split(/\r?\n/);
    assert.ok(!branches.some((b) => b.startsWith('claudius-tmp/')), `the placeholder branch is gone: ${branches}`);
  });
});

test('provider auto: a session Orca started uses Orca, any other uses the pool', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'auto' });
    const tools = fakeTools(boundary, w.env);

    const cli = slot(w, ['take', 'feat/cli'], w.main, { env: tools.env });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(lastLine(cli.stdout), join(w.pool, 'slot-1'));

    const inOrca = slot(w, ['take', 'feat/orca'], w.main, { env: { ...tools.env, CLAUDE_CODE_ENTRYPOINT: 'orca' } });
    assert.equal(inOrca.status, 0, inOrca.stderr);
    assert.equal(canonical(lastLine(inOrca.stdout)), canonical(join(tools.base, 'orca')));

    const status = slot(w, ['status'], w.main, { env: { ...tools.env, ORCA_AGENT_SESSION_ID: 'x' } });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stderr, /provider auto → orca/);
    assert.match(status.stdout, /\(orca\) orca/);
    assert.match(status.stdout, /slot-1/);
  });
});

test('provider shows and switches who creates worktrees, and refuses nonsense', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, {});
    assert.match(slot(w, ['provider']).stderr, /Provider: pool/);
    assert.equal(slot(w, ['provider', 'auto']).status, 0);
    const config = JSON.parse(readFileSync(join(w.home, '.claude', 'context', basename(w.main), 'workspace.json'), 'utf8'));
    assert.equal(config.provider, 'auto');
    assert.equal(config.base, 'origin/main', 'the rest of the config is kept');
    assert.equal(slot(w, ['provider', 'docker']).status, 2);
  });
});

test('provider orca: the guard and the notice send the session to an Orca worktree', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'auto', protect: ['apps/'] });
    const orcaEnv = { ...w.env, CLAUDE_CODE_ENTRYPOINT: 'orca' };
    const file = join(w.main, 'apps', 'a.js');

    assert.match(denial(runHook('guard-main-tree.mjs', edit(file), { env: orcaEnv })), /Orca worktree: .*take <branch-name>/);
    assert.match(denial(runHook('guard-main-tree.mjs', edit(file), { env: w.env })), /Claim a worktree slot/);
    assert.match(runHook('workspace-notice.mjs', { cwd: w.main }, { env: orcaEnv }).stdout, /works in Orca worktrees/);
    assert.match(runHook('workspace-notice.mjs', { cwd: w.main }, { env: w.env }).stdout, /uses a worktree pool/);

    const tools = fakeTools(boundary, w.env);
    const path = lastLine(slot(w, ['take', 'feat/x'], w.main, { env: { ...tools.env, CLAUDE_CODE_ENTRYPOINT: 'orca' } }).stdout);
    assert.equal(denial(runHook('guard-main-tree.mjs', edit(join(path, 'apps', 'a.js')), { env: orcaEnv })), null);
    assert.match(runHook('workspace-notice.mjs', { cwd: path }, { env: orcaEnv }).stdout, /stays until its pull request merges/);
  });
});

test('provider orca: release checks the worktree is pushed and frees nothing', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'orca' });
    const tools = fakeTools(boundary, w.env);
    const path = lastLine(slot(w, ['take', 'feat/x'], w.main, { env: tools.env }).stdout);
    writeFileSync(join(path, 'x.txt'), 'x');
    git(path, 'add', '.');
    git(path, 'commit', '-qm', 'x');

    const refused = slot(w, ['release'], path, { env: tools.env });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /unpushed/);

    git(path, 'push', '-q', '-u', 'origin', 'feat/x');
    const released = slot(w, ['release'], path, { env: tools.env });
    assert.equal(released.status, 0, released.stderr);
    assert.match(released.stderr, /nothing is freed/);
    assert.equal(git(path, 'branch', '--show-current'), 'feat/x');
  });
});

test('provider orca: sweep removes a merged Orca worktree through Orca and leaves the rest', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'orca' });
    const tools = fakeTools(boundary, w.env);
    const made = (branch) => {
      const path = lastLine(slot(w, ['take', branch], w.main, { env: tools.env }).stdout);
      writeFileSync(join(path, 'x.txt'), branch);
      git(path, 'add', '.');
      git(path, 'commit', '-qm', branch);
      git(path, 'push', '-q', '-u', 'origin', branch);
      return path;
    };
    const done = made('feat/done');
    const dirty = made('feat/dirty');
    writeFileSync(join(dirty, 'wip.txt'), 'not committed');
    const ide = join(boundary, 'ide-task');
    git(w.main, 'worktree', 'add', '-q', '-b', 'feat/ide', ide, 'origin/main');
    writeFileSync(tools.env.FAKE_GH_PRS, JSON.stringify(['feat/done', 'feat/dirty', 'feat/ide'].map((branch, i) => ({
      headRefName: branch, headRefOid: git(w.main, 'rev-parse', branch), isCrossRepository: false, number: i + 1, state: 'MERGED',
    }))));

    const dry = slot(w, ['sweep'], w.main, { env: tools.env });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stderr, /\[dry run\] remove Orca worktree done/);
    assert.match(dry.stderr, /SKIP dirty .*uncommitted/);
    assert.match(dry.stderr, /LEAVE ide-task/);
    assert.ok(existsSync(done));

    const result = slot(w, ['sweep', '--yes'], w.main, { env: tools.env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(done), 'the merged Orca worktree is removed');
    assert.ok(orcaCalls(tools).some((call) => call[1] === 'rm'), 'through Orca, so its record goes too');
    assert.ok(existsSync(join(dirty, 'wip.txt')) && existsSync(ide));
    const branches = git(w.main, 'branch', '--format=%(refname:short)').split(/\r?\n/);
    assert.ok(!branches.includes('feat/done') && branches.includes('feat/dirty') && branches.includes('feat/ide'));
  });
});

test('prepare runs the steps in the worktree it is called from, and a new worktree of the same name starts fresh', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      copy: ['.env.local'],
      prepare: [{ when: ['package.json'], run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    writeFileSync(join(w.main, '.env.local'), 'SECRET=1\n');
    const uiMade = join(boundary, 'ui-task');
    git(w.main, 'worktree', 'add', '-q', '-b', 'feat/ui', uiMade, 'origin/main');

    assert.equal(slot(w, ['prepare'], uiMade).status, 0);
    assert.equal(slot(w, ['prepare'], uiMade).status, 0);
    assert.equal(readFileSync(marker, 'utf8'), 'x', 'the second run finds nothing changed');
    assert.equal(readFileSync(join(uiMade, '.env.local'), 'utf8'), 'SECRET=1\n');

    git(w.main, 'worktree', 'remove', '--force', uiMade);
    git(w.main, 'worktree', 'add', '-q', '-b', 'feat/ui-2', uiMade, 'origin/main');
    assert.equal(slot(w, ['prepare'], uiMade).status, 0);
    assert.equal(readFileSync(marker, 'utf8'), 'xx', 'a new worktree in the same folder is prepared again');

    assert.equal(slot(w, ['prepare'], w.main).status, 2, 'the main tree is the source, not a target');
  });
});

test('provider orca without the Orca CLI refuses and names the ways out', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'orca', orca: { cli: join(boundary, 'no-such-orca') } });
    const result = slot(w, ['take', 'feat/x']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Orca CLI .* was not found.*provider pool/);
    assert.equal(git(w.main, 'branch', '--list', 'feat/x'), '');
  });
});

test('provider orca: a branch out in a worktree Orca did not make is refused, not prepared underneath it', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const marker = join(boundary, 'prepared.log').replaceAll('\\', '/');
    const w = world(boundary, {
      provider: 'orca',
      prepare: [{ run: `node -e "require('fs').appendFileSync('${marker}','x')"` }],
    });
    const tools = fakeTools(boundary, w.env);
    const hand = join(tools.base, 'hand-made');
    git(w.main, 'worktree', 'add', '-q', '-b', 'feat/hand', hand, 'origin/main');

    const result = slot(w, ['take', 'feat/hand'], w.main, { env: tools.env });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /which Orca did not make/);
    assert.ok(!existsSync(marker), 'nothing ran in it');

    const status = slot(w, ['status'], w.main, { env: tools.env });
    assert.match(status.stdout, /\(other\)/);
    assert.doesNotMatch(status.stdout, /\(orca\)/);
  });
});

test('a mistyped provider is reported by every command, fixed by provider, and never stops session-end', () => {
  withTmpDir('claudius-pool-', (boundary) => {
    const w = world(boundary, { provider: 'orac' });
    const result = slot(w, ['status']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown provider "orac"/);
    assert.equal(slot(w, ['session-end'], w.main, { input: JSON.stringify({ cwd: w.main, session_id: 's' }) }).status, 0);
    assert.equal(slot(w, ['provider', 'auto']).status, 0);
    assert.equal(slot(w, ['status']).status, 0);
  });
});
