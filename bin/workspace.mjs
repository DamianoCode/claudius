#!/usr/bin/env node
// How a repository isolates work in progress, switchable per repository:
//
//   worktrees — a pool of long-lived git worktrees ("slots") for parallel sessions,
//               instead of a fresh worktree per task. A fresh worktree pays the full cost
//               every time: dependencies installed from nothing, cold build caches, missing
//               untracked env files, and a directory nobody removes once the pull request
//               merges. A slot outlives the task — only the branch changes, and what is
//               expensive to rebuild stays put.
//   branches  — one checkout, one branch per task. `take` switches the main tree, and the
//               same prepare steps run when the lockfile moves. Right for a single session
//               at a time; parallel sessions would share the checkout.
//
// Slots live beside the repository by default, in ../<repo>-worktrees/<prefix>-N: nothing
// appears inside the working tree, and paths stay as short as the repository's own.
// A session moves into a slot with Claude Code's EnterWorktree, which asks once per entry
// for a path outside .claude/worktrees. Setting "pool" to ".claude/worktrees" trades that
// prompt for deeper paths inside the repository; the directory is then added to the
// local .git/info/exclude, never to a tracked file. Either way every slot is
// `git worktree lock`ed, so neither Claude Code's periodic worktree sweep nor
// `git worktree prune/remove` can take a warm slot away.
//
// Nothing here is imposed. Without a workspace.json a repository keeps whatever workflow
// it already has — the hooks stay silent and this CLI refuses to act. `mode off` pauses
// a configured repository without deleting its config; CLAUDIUS_WORKSPACE=off switches
// the feature off everywhere.
//
// Opt-in per repository through the private overlay, never through the working tree:
//
//   ~/.claude/context/<repo>/workspace.json
//   {
//     "mode": "worktrees",              or "branches", or "off"; switch with `workspace.mjs mode <m>`
//     "pool": "../my-repo-worktrees",   where slots live, relative to the main tree (this is the default)
//     "prefix": "slot",                 slot folders are <prefix>-1, <prefix>-2, …
//     "size": 5,                        most slots ever created
//     "base": "origin/release/*",       new branches start from the newest matching ref
//     "protect": ["apps/", "libs/"],    paths the edit guard watches
//     "protectedBranches": ["release/*", "master"],   branch mode: never edited directly
//                                       (default: the base without its remote, main, master)
//     "keep": ["node_modules", ".env*"],     survive the clean between tasks in a slot
//     "copy": [".env.local"],           copied from the main tree when a slot lacks them
//     "prepare": [                      run after every switch; `when` = only if those files (globs) changed
//       { "when": ["pnpm-lock.yaml"], "run": "pnpm install --frozen-lockfile" }
//     ]
//   }
//
// Commands (run from anywhere inside the repository or one of its worktrees):
//   workspace.mjs init [--mode m] [--pool dir] [--prefix p] [--size n] [--base ref]
//                      [--protect a/,b/] [--dry-run] [--force]
//                                  propose a config from the repository and write it
//   workspace.mjs                  status
//   workspace.mjs take <branch> [--base <ref>]
//                                  worktrees: claim a slot, last stdout line = its path
//                                  branches:  switch the main tree to the branch
//   workspace.mjs release [<prefix>-N] [--force]
//                                  refuses while work is uncommitted or unpushed
//   workspace.mjs mode [worktrees|branches|off]
//                                  show or switch the mode
//   workspace.mjs sweep [--yes]    free slots and remove old worktrees whose PR has merged
//   workspace.mjs session-end      SessionEnd hook: free the ending session's slots when safe
//
// A claim records the Claude Code session and process that made it. A slot whose
// session has ended is reclaimed only when nothing in it would be lost; otherwise it
// stays "orphaned" until someone takes its branch again or releases it by hand.
//
// Progress goes to stderr, so `take` can be consumed as `cd "$(node workspace.mjs take x)"`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { canonical, locateRepo } from '../hooks/lib/repo.mjs';
import { MODES, configPath as workspaceConfigPath, disabledEverywhere } from '../hooks/lib/workspace.mjs';
import { detectConfig } from './lib/detect.mjs';

const log = (...parts) => console.error(...parts);
const LOCK_REASON = 'claudius worktree pool';

class Refusal extends Error {}

// --- process helpers --------------------------------------------------------

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

function gitOk(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0;
}

// Prepare steps are shell lines from the user's own config; stdout is discarded so the
// last line of `take` stays the slot path.
function shell(cwd, line) {
  const result = spawnSync(line, { cwd, shell: true, stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) throw new Error(`prepare step failed (${result.status}): ${line}`);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // exists, owned by someone else
  }
}

// --- repository and config --------------------------------------------------

function loadContext(start) {
  if (disabledEverywhere()) throw new Refusal('The workspace feature is switched off (CLAUDIUS_WORKSPACE=off).');
  const repo = locateRepo(start);
  if (!repo) throw new Refusal('Not inside a git repository.');
  const configPath = workspaceConfigPath(repo.main);
  if (!existsSync(configPath)) {
    throw new Refusal(`No workspace configured for this repository — it keeps its own workflow. To opt in: workspace.mjs init`);
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  if (raw.mode !== undefined && !MODES.includes(raw.mode)) {
    throw new Refusal(`Unknown mode "${raw.mode}" in ${configPath}. Use ${MODES.join(' or ')}.`);
  }
  const prefix = raw.prefix ?? 'slot';
  if (!/^[A-Za-z0-9._]+(?:-[A-Za-z0-9._]+)*$/.test(prefix)) {
    throw new Refusal(`"prefix" must be a plain folder name (letters, digits, dots, dashes), got "${prefix}".`);
  }
  const pool = canonical(resolve(repo.main, raw.pool ?? `../${basename(repo.main)}-worktrees`));
  return {
    configPath,
    raw,
    mode: raw.mode ?? 'worktrees',
    prefix,
    slotName: new RegExp(`^${prefix.replace(/\./g, '\\.')}-(\\d+)$`),
    start: canonical(start),
    main: repo.main,
    pool,
    // Inside the shared .git directory: one copy for every worktree, and out of reach of a
    // `git clean -fdx` in the main tree, which would wipe a state folder kept in the pool.
    state: join(repo.main, '.git', 'claudius-slots'),
    size: raw.size ?? 5,
    base: raw.base ?? null,
    keep: raw.keep ?? [],
    copy: raw.copy ?? [],
    prepare: raw.prepare ?? [],
  };
}

// Every worktree of the repository; the first entry is always the main tree.
function worktrees(ctx) {
  return git(ctx.main, 'worktree', 'list', '--porcelain')
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const fields = Object.fromEntries(block.split(/\r?\n/).map((line) => {
        const [key, ...rest] = line.split(' ');
        return [key, rest.join(' ')];
      }));
      return {
        path: canonical(fields.worktree),
        branch: fields.branch?.replace('refs/heads/', '') || null,
        locked: 'locked' in fields,
        lockReason: fields.locked ?? null,
      };
    });
}

// A slot also carries a mark in its own folder under .git/worktrees, which goes when the
// worktree goes. The lock can be lifted by others — `git worktree unlock`, a tool that clears
// locks it did not write — and the mark is what still tells a slot from a lookalike then.
const SLOT_MARK = 'claudius-slot';

function adminDir(path) {
  try {
    const match = readFileSync(join(path, '.git'), 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
    return match ? resolve(path, match[1]) : null;
  } catch {
    return null;
  }
}

const marked = (wt) => {
  const dir = adminDir(wt.path);
  return dir !== null && existsSync(join(dir, SLOT_MARK));
};

// Name and place alone are not enough: `claude -w slot-3` lands in the same directory.
// A slot carries the pool's lock, or — once someone lifted it — the pool's mark and no
// other lock. Anything else is never cleaned.
const isSlot = (ctx, wt) => dirname(wt.path) === ctx.pool && ctx.slotName.test(basename(wt.path))
  && (wt.lockReason === LOCK_REASON || (!wt.locked && marked(wt)));
const slotNumber = (ctx, name) => Number(name.match(ctx.slotName)[1]);

function slots(ctx) {
  return worktrees(ctx)
    .filter((wt) => isSlot(ctx, wt))
    .map((wt) => ({ ...wt, name: basename(wt.path) }))
    .sort((a, b) => slotNumber(ctx, a.name) - slotNumber(ctx, b.name));
}

const lockFile = (ctx, name) => join(ctx.state, `${name}.json`);

function readClaim(ctx, name) {
  const path = lockFile(ctx, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { corrupt: true };
  }
}

// A claim made outside Claude Code has no process to watch and never expires on its own.
function claimState(claim) {
  if (!claim) return 'free';
  if (claim.pid && !processAlive(claim.pid)) return 'orphaned';
  return 'claimed';
}

function writeClaim(ctx, name, branch) {
  writeFileSync(lockFile(ctx, name), JSON.stringify({
    branch: branch ?? null,
    owner: process.env.USER ?? process.env.USERNAME ?? null,
    session: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    pid: Number(process.env.CLAUDE_PID) || null,
    since: new Date().toISOString(),
  }, null, 2));
}

const isClean = (path) => git(path, 'status', '--porcelain') === '';
// Commits reachable from HEAD that no remote has — the work a deleted directory would take with it.
const unpushed = (path) => Number(git(path, 'rev-list', '--count', 'HEAD', '--not', '--remotes'));

function unsafeReason(path) {
  if (!isClean(path)) return 'uncommitted changes';
  const count = unpushed(path);
  return count > 0 ? `${count} unpushed commit(s)` : null;
}

// Claiming is check-then-write; a directory created with mkdir is the cheapest
// cross-platform mutex, so two sessions starting at once never share a slot.
function withMutex(ctx, fn) {
  mkdirSync(ctx.state, { recursive: true });
  const mutex = join(ctx.state, '.mutex');
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      mkdirSync(mutex);
      break;
    } catch {
      if (Date.now() > deadline) throw new Refusal(`Pool mutex held for over 30 s. Remove ${mutex} if nothing is running.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

// A pool inside the main tree would show up as untracked there. The repository-local
// exclude file hides it without touching anything a teammate would pull.
function ensureExcluded(ctx) {
  const rel = relative(ctx.main, ctx.pool);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return;
  const commonDir = git(ctx.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const exclude = join(commonDir, 'info', 'exclude');
  const entry = `/${rel.split(sep).join('/')}/`;
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (current.split(/\r?\n/).includes(entry)) return;
  mkdirSync(dirname(exclude), { recursive: true });
  appendFileSync(exclude, `${current === '' || current.endsWith('\n') ? '' : '\n'}# ${LOCK_REASON}\n${entry}\n`);
  log(`  added ${entry} to ${exclude}`);
}

// --- preparing a slot -------------------------------------------------------

function baseRef(ctx, explicit) {
  const wanted = explicit ?? ctx.base;
  if (wanted && !wanted.includes('*')) return wanted;
  if (wanted) {
    const pattern = `refs/remotes/${wanted}`;
    const newest = git(ctx.main, 'for-each-ref', '--sort=-committerdate', '--count=1', '--format=%(refname:short)', pattern);
    if (newest) return newest;
    log(`No ref matches ${wanted}; falling back to the remote default branch.`);
  }
  return gitOk(ctx.main, 'rev-parse', '--verify', '--quiet', 'origin/HEAD') ? 'origin/HEAD' : 'HEAD';
}

// Paths relative to the main tree; `*` inside a segment matches within that directory only.
function expand(root, pattern) {
  let found = [''];
  for (const segment of pattern.split('/').filter(Boolean)) {
    if (!segment.includes('*')) {
      found = found.map((rel) => join(rel, segment)).filter((rel) => existsSync(join(root, rel)));
      continue;
    }
    const matcher = new RegExp(`^${segment.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    found = found.flatMap((rel) => {
      try {
        return readdirSync(join(root, rel)).filter((name) => matcher.test(name)).map((name) => join(rel, name));
      } catch {
        return [];
      }
    });
  }
  return found.filter(Boolean);
}

// Untracked files a checkout cannot recreate. Only fills gaps: a slot's own copy wins.
// The parent must already exist in the slot, so a build directory inside dependencies is
// copied after the install that creates its parent, never into a half-made tree.
function copyMissing(ctx, slotPath) {
  if (slotPath === ctx.main) return; // branch mode: the main tree is the source
  for (const pattern of ctx.copy) {
    for (const rel of expand(ctx.main, pattern)) {
      const target = join(slotPath, rel);
      if (existsSync(target) || !existsSync(dirname(target))) continue;
      cpSync(join(ctx.main, rel), target, { recursive: true });
      log(`  copied ${rel}`);
    }
  }
}

// Patterns with `*` cover every match, so a schema split over many files still has one stamp.
function fingerprint(root, patterns) {
  const hash = createHash('sha1');
  const files = patterns.flatMap((pattern) => (pattern.includes('*') ? expand(root, pattern).sort() : [pattern]));
  for (const file of files) {
    const path = join(root, file);
    hash.update(`${file}\0${existsSync(path) ? readFileSync(path) : 'absent'}\0`);
  }
  return hash.digest('hex');
}

function prepare(ctx, slot) {
  copyMissing(ctx, slot.path);
  mkdirSync(ctx.state, { recursive: true }); // branch mode never passes through the claim mutex
  const stampsPath = join(ctx.state, `${slot.name}.prepared.json`);
  const stamps = existsSync(stampsPath) ? JSON.parse(readFileSync(stampsPath, 'utf8')) : {};

  for (const step of ctx.prepare) {
    if (step.when) {
      const current = fingerprint(slot.path, step.when);
      if (stamps[step.run] === current) continue;
      log(`  ${step.run}  (${step.when.join(', ')} changed)`);
      shell(slot.path, step.run);
      stamps[step.run] = current;
      writeFileSync(stampsPath, JSON.stringify(stamps, null, 2));
    } else {
      log(`  ${step.run}`);
      shell(slot.path, step.run);
    }
  }
  copyMissing(ctx, slot.path);
}

// --- commands ---------------------------------------------------------------

// Resuming: the branch is already checked out somewhere. Git allows one checkout per
// branch, so the only honest answers are "adopt that slot" or "it is someone else's".
function slotHoldingBranch(ctx, branch) {
  const holder = worktrees(ctx).slice(1).find((wt) => wt.branch === branch);
  if (!holder) return null;
  if (!isSlot(ctx, holder)) {
    throw new Refusal(`${branch} is checked out in ${holder.path}, outside the pool. Work there, or free it first.`);
  }
  const name = basename(holder.path);
  const claim = readClaim(ctx, name);
  const mine = claim?.session && claim.session === process.env.CLAUDE_CODE_SESSION_ID;
  if (claimState(claim) === 'claimed' && !mine) {
    throw new Refusal(`${branch} is in use in ${name} by another live session (since ${claim.since}).`);
  }
  return { path: holder.path, name, adopted: true };
}

function mark(path) {
  const dir = adminDir(path);
  if (dir && !existsSync(join(dir, SLOT_MARK))) writeFileSync(join(dir, SLOT_MARK), `${LOCK_REASON}\n`);
}

// Puts back a lifted lock, and marks slots made before the mark existed.
function lockAndMark(ctx, slot) {
  if (!slot.locked) {
    git(ctx.main, 'worktree', 'lock', '--reason', LOCK_REASON, slot.path);
    log(`  ${slot.name} had lost its pool lock — locked again.`);
  }
  mark(slot.path);
}

function pickSlot(ctx, ref) {
  const existing = slots(ctx);
  const free = existing.find((s) => claimState(readClaim(ctx, s.name)) === 'free' && isClean(s.path))
    ?? existing.find((s) => claimState(readClaim(ctx, s.name)) === 'orphaned' && !unsafeReason(s.path));
  if (free) {
    if (readClaim(ctx, free.name)) log(`Reclaiming ${free.name} — its session has ended and nothing in it is unpushed.`);
    return { path: free.path, name: free.name, fresh: false };
  }

  const used = new Set(existing.map((s) => slotNumber(ctx, s.name)));
  let n = 1;
  while (used.has(n)) n++;
  if (n > ctx.size) throw new Refusal(`All ${ctx.size} slots are claimed. Release one (release / sweep) or raise "size".`);
  const name = `${ctx.prefix}-${n}`;
  const path = join(ctx.pool, name);
  if (existsSync(path)) throw new Refusal(`${path} exists but is not a slot of this repository.`);
  log(`Creating ${name}…`);
  ensureExcluded(ctx);
  git(ctx.main, 'worktree', 'add', '--detach', path, ref);
  git(ctx.main, 'worktree', 'lock', '--reason', LOCK_REASON, path);
  mark(path);
  return { path, name, fresh: true };
}

function take(ctx, branch, { base } = {}) {
  gitOk(ctx.main, 'fetch', '--prune', '--quiet', 'origin');
  const ref = baseRef(ctx, base);

  const slot = withMutex(ctx, () => {
    for (const s of slots(ctx)) lockAndMark(ctx, s);
    const chosen = (branch && slotHoldingBranch(ctx, branch)) || pickSlot(ctx, ref);
    writeClaim(ctx, chosen.name, branch);
    return chosen;
  });

  try {
    if (slot.adopted) {
      log(`${slot.name}: resuming ${branch}`);
    } else {
      log(`${slot.name}: ${branch ?? '(detached)'} from ${ref}`);
      // Leftovers of the previous task go; what is expensive to rebuild stays.
      if (!slot.fresh) git(slot.path, 'clean', '-fdxq', ...ctx.keep.flatMap((pattern) => ['-e', pattern]));
      if (!branch) {
        git(slot.path, 'switch', '--detach', ref);
      } else if (gitOk(ctx.main, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`)) {
        git(slot.path, 'switch', branch);
      } else if (gitOk(ctx.main, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`)) {
        git(slot.path, 'switch', '-c', branch, '--track', `origin/${branch}`);
      } else {
        git(slot.path, 'switch', '-c', branch, '--no-track', ref);
      }
    }
    prepare(ctx, slot);
  } catch (error) {
    if (!slot.adopted) rmSync(lockFile(ctx, slot.name), { force: true });
    throw error;
  }

  log(`Ready. Switch the session into it with EnterWorktree (path: ${slot.path}), or work under that path.`);
  console.log(slot.path);
}

function findSlot(ctx, arg) {
  const all = slots(ctx);
  const slot = arg
    ? all.find((s) => s.name === arg || s.path === canonical(arg))
    : all.find((s) => ctx.start === s.path || ctx.start.startsWith(s.path + sep));
  if (!slot) throw new Refusal(arg ? `No slot named ${arg}.` : `Not inside a slot — name one: release ${ctx.prefix}-N.`);
  return slot;
}

function freeSlot(ctx, slot, { discard = false } = {}) {
  git(slot.path, 'switch', '--detach', '--quiet', ...(discard ? ['--discard-changes'] : []));
  rmSync(lockFile(ctx, slot.name), { force: true });
}

function release(ctx, arg, { force = false } = {}) {
  const slot = findSlot(ctx, arg);
  const reason = unsafeReason(slot.path);
  if (reason && !force) throw new Refusal(`${slot.name} not released: ${reason}. Push first, or pass --force.`);
  freeSlot(ctx, slot, { discard: force });
  const onRemote = slot.branch && gitOk(ctx.main, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${slot.branch}`);
  const kept = slot.branch ? ` — branch ${slot.branch} kept locally${onRemote ? ' and on origin' : ''}` : '';
  log(`${slot.name} released${kept}. If the session is inside it, leave with ExitWorktree (action: keep).`);
}

// SessionEnd: the ending session's slots go back to the pool when nothing would be lost.
// Never refuses anything and never prints to stdout — a session must always be able to end.
function sessionEnd(ctx, sessionId) {
  if (!sessionId || ctx.mode === 'off') return;
  for (const slot of slots(ctx)) {
    const claim = readClaim(ctx, slot.name);
    if (claim?.session !== sessionId) continue;
    const reason = unsafeReason(slot.path);
    if (reason) {
      log(`${slot.name} stays claimed: ${reason}. Resume with take ${slot.branch ?? '<branch>'}.`);
      continue;
    }
    freeSlot(ctx, slot);
    log(`${slot.name} released at session end.`);
  }
}

// git leaves a partial directory behind when it cannot delete something — on Windows,
// typically a dependency path past 260 characters. Node removes those; git already has.
function removeWorktree(ctx, path) {
  git(ctx.main, 'worktree', 'remove', path);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true, maxRetries: 3 });
}

// One GitHub query for every branch instead of one per worktree. Without gh the PR
// column stays empty and sweep does nothing, which is the safe failure.
function pullRequestsByBranch(ctx) {
  const result = spawnSync('gh', ['pr', 'list', '--state', 'all', '--limit', '300', '--json', 'headRefName,number,state'], {
    cwd: ctx.main, encoding: 'utf8',
  });
  if (result.status !== 0) {
    log('gh is unavailable — pull request state skipped.');
    return new Map();
  }
  const byBranch = new Map();
  for (const pr of JSON.parse(result.stdout)) if (!byBranch.has(pr.headRefName)) byBranch.set(pr.headRefName, pr);
  return byBranch;
}

// --- branch mode ------------------------------------------------------------

// The local name of a remote base: origin/release/2026-w36 → release/2026-w36.
function localBase(ctx, ref) {
  const remote = ref === 'origin/HEAD' ? git(ctx.main, 'rev-parse', '--abbrev-ref', 'origin/HEAD') : ref;
  return remote.replace(/^origin\//, '');
}

function takeBranch(ctx, branch, { base } = {}) {
  if (!branch) throw new Refusal('Name the branch: take <branch-name>.');
  const current = git(ctx.main, 'branch', '--show-current');
  if (current !== branch && !isClean(ctx.main)) {
    throw new Refusal('The checkout has uncommitted changes — commit them first, or they would travel to the new branch. '
      + 'Several sessions at once need worktrees mode: workspace.mjs mode worktrees');
  }
  gitOk(ctx.main, 'fetch', '--prune', '--quiet', 'origin');
  const ref = baseRef(ctx, base);
  if (current === branch) {
    log(`Already on ${branch}.`);
  } else if (gitOk(ctx.main, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`)) {
    git(ctx.main, 'switch', '--quiet', branch);
  } else if (gitOk(ctx.main, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`)) {
    git(ctx.main, 'switch', '--quiet', '-c', branch, '--track', `origin/${branch}`);
  } else {
    git(ctx.main, 'switch', '--quiet', '-c', branch, '--no-track', ref);
  }
  prepare(ctx, { path: ctx.main, name: 'main' });
  log(`Ready on ${branch}, in ${ctx.main}.`);
  console.log(ctx.main);
}

function releaseBranch(ctx) {
  const reason = unsafeReason(ctx.main);
  if (reason) throw new Refusal(`Not leaving the branch: ${reason}. Push first.`);
  const target = localBase(ctx, baseRef(ctx));
  const left = git(ctx.main, 'branch', '--show-current');
  git(ctx.main, 'switch', '--quiet', target);
  gitOk(ctx.main, 'merge', '--ff-only', '--quiet', '@{u}');
  prepare(ctx, { path: ctx.main, name: 'main' });
  log(`Back on ${target}${left && left !== target ? ` — ${left} kept locally and on origin` : ''}.`);
}

function setMode(ctx, wanted) {
  if (!wanted) {
    log(`Mode: ${ctx.mode}  (${ctx.configPath})`);
    return;
  }
  if (!MODES.includes(wanted)) throw new Refusal(`Unknown mode "${wanted}". Use ${MODES.join(' or ')}.`);
  if (wanted === ctx.mode) {
    log(`Already in ${wanted} mode.`);
    return;
  }
  if (wanted === 'branches') {
    const busy = slots(ctx).filter((s) => claimState(readClaim(ctx, s.name)) !== 'free');
    for (const s of busy) log(`Note: ${s.name} (${s.branch ?? 'detached'}) is still claimed — finish or release it there.`);
  }
  writeFileSync(ctx.configPath, `${JSON.stringify({ ...ctx.raw, mode: wanted }, null, 2)}\n`);
  const next = {
    branches: 'take <branch> now switches this checkout; slots stay on disk for later.',
    worktrees: 'take <branch> now claims a worktree slot.',
    off: 'the hooks are silent and take/release refuse; the config and any slots are kept.',
  };
  log(`Mode: ${wanted} — ${next[wanted]}`);
}

function status(ctx) {
  if (ctx.mode === 'branches') {
    const branch = git(ctx.main, 'branch', '--show-current') || '(detached)';
    log(`Mode: branches — ${ctx.main} on ${branch}, ${unsafeReason(ctx.main) ?? 'clean and pushed'}.`);
  }
  const prs = pullRequestsByBranch(ctx);
  const rows = worktrees(ctx).slice(1).map((wt) => {
    const name = basename(wt.path);
    const slot = isSlot(ctx, wt);
    const claim = slot ? readClaim(ctx, name) : null;
    const pr = wt.branch ? prs.get(wt.branch) : null;
    return {
      worktree: slot ? name : `(other) ${relative(ctx.main, wt.path) || wt.path}`,
      state: slot ? claimState(claim) : (wt.locked ? 'locked' : ''),
      branch: wt.branch ?? '(detached)',
      changes: git(wt.path, 'status', '--porcelain').split(/\r?\n/).filter(Boolean).length,
      unpushed: unpushed(wt.path),
      pr: pr ? `${pr.number} ${pr.state}` : '',
      since: claim?.since?.slice(0, 16).replace('T', ' ') ?? '',
    };
  });
  if (rows.length === 0) log('No worktrees besides the main tree.');
  else console.table(rows);
}

function sweep(ctx, { yes = false } = {}) {
  const prs = pullRequestsByBranch(ctx);
  let planned = 0;
  for (const wt of worktrees(ctx).slice(1)) {
    const name = basename(wt.path);
    const slot = isSlot(ctx, wt);
    const claim = slot ? readClaim(ctx, name) : null;
    const pr = wt.branch ? prs.get(wt.branch) : null;
    const orphaned = slot && claimState(claim) === 'orphaned';

    if (slot && !claim) continue;
    if (!slot && wt.locked) continue; // someone's live session — Claude Code locks those
    if (pr?.state !== 'MERGED' && !orphaned) continue;

    const reason = unsafeReason(wt.path);
    const why = pr?.state === 'MERGED' ? `PR ${pr.number} merged` : 'its session has ended';
    if (reason) {
      log(`SKIP ${name} (${wt.branch ?? 'detached'}, ${why}): ${reason} — check by hand.`);
      continue;
    }
    planned++;
    log(`${yes ? '' : '[dry run] '}${slot ? 'release slot' : 'remove worktree'} ${name} — ${wt.branch ?? 'detached'}, ${why}`);
    if (!yes) continue;
    try {
      if (slot) freeSlot(ctx, { ...wt, name });
      else removeWorktree(ctx, wt.path);
      // Squash merges leave the branch "unmerged" to git although its content is upstream.
      if (wt.branch && pr?.state === 'MERGED') git(ctx.main, 'branch', '-D', wt.branch);
    } catch (error) {
      log(`FAILED ${name}: ${error.message.split('\n').pop()}`);
    }
  }
  if (yes) git(ctx.main, 'worktree', 'prune');
  if (planned === 0) log('Nothing to sweep.');
  else if (!yes) log('\nNothing changed. Run with --yes to apply.');
}

// --- init -------------------------------------------------------------------

function init(start, opts) {
  if (disabledEverywhere()) throw new Refusal('The workspace feature is switched off (CLAUDIUS_WORKSPACE=off).');
  const repo = locateRepo(start);
  if (!repo) throw new Refusal('Not inside a git repository.');
  const path = workspaceConfigPath(repo.main);
  if (existsSync(path) && !opts.force && !opts.dryRun) {
    throw new Refusal(`${path} already exists. Edit it, switch with "mode", or pass --force to replace it.`);
  }

  const { config, reasons, hints } = detectConfig(repo.main);
  if (opts.mode !== undefined) {
    if (!MODES.includes(opts.mode)) throw new Refusal(`Unknown mode "${opts.mode}". Use ${MODES.join(', ')}.`);
    config.mode = opts.mode;
  }
  if (opts.pool !== undefined) { config.pool = opts.pool; reasons.pool = 'given'; }
  if (opts.prefix !== undefined) config.prefix = opts.prefix;
  if (opts.size !== undefined) {
    const size = Number(opts.size);
    if (!Number.isInteger(size) || size < 1) throw new Refusal(`--size must be a whole number of at least 1, got "${opts.size}".`);
    config.size = size;
  }
  if (opts.base !== undefined) { config.base = opts.base; reasons.base = 'given'; }
  if (opts.protect !== undefined) {
    config.protect = opts.protect.split(',').map((p) => p.trim()).filter(Boolean);
    reasons.protect = 'given';
  }
  if (!/^[A-Za-z0-9._]+(?:-[A-Za-z0-9._]+)*$/.test(config.prefix)) {
    throw new Refusal(`"prefix" must be a plain folder name (letters, digits, dots, dashes), got "${config.prefix}".`);
  }
  if (config.mode === 'branches') {
    for (const key of ['pool', 'prefix', 'size', 'keep', 'copy']) delete config[key];
  }

  for (const [key, why] of Object.entries(reasons)) if (key in config) log(`  ${key.padEnd(8)} ${why}`);
  for (const hint of hints) log(`  hint     ${hint}`);
  const text = `${JSON.stringify(config, null, 2)}\n`;
  if (opts.dryRun) {
    log(`\nDry run — nothing written. Would create ${path}:`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    log(`\nWrote ${path} — a starting point: edit it freely, or remove it to opt out again.`);
  }
  process.stdout.write(text);
}

// --- entry ------------------------------------------------------------------

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

const [command = 'status', ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const VALUED = new Set(['--base', '--mode', '--pool', '--prefix', '--size', '--protect']);
const positional = rest.find((arg, i) => !arg.startsWith('--') && !VALUED.has(rest[i - 1]));

if (command === 'session-end') {
  // A hook: silent without a pool, and never a failing exit.
  try {
    const input = readHookInput();
    sessionEnd(loadContext(input.cwd || process.cwd()), input.session_id);
  } catch (error) {
    if (!(error instanceof Refusal)) log(`session-end: ${error.message}`);
  }
  process.exit(0);
}

if (command === 'init') {
  try {
    init(process.cwd(), {
      mode: option('--mode'), pool: option('--pool'), prefix: option('--prefix'), size: option('--size'),
      base: option('--base'), protect: option('--protect'), dryRun: flag('--dry-run'), force: flag('--force'),
    });
    process.exit(0);
  } catch (error) {
    log(error.message);
    process.exit(error instanceof Refusal ? 2 : 1);
  }
}

try {
  const ctx = loadContext(process.cwd());
  if (ctx.mode === 'off' && ['take', 'release'].includes(command)) {
    throw new Refusal('The workspace is off for this repository. Turn it on with: workspace.mjs mode worktrees (or branches)');
  }
  switch (command) {
    case 'status': status(ctx); break;
    case 'take':
      if (ctx.mode === 'branches') takeBranch(ctx, positional, { base: option('--base') });
      else take(ctx, positional, { base: option('--base') });
      break;
    case 'release':
      if (ctx.mode === 'branches' && !positional) releaseBranch(ctx);
      else release(ctx, positional, { force: flag('--force') });
      break;
    case 'mode': setMode(ctx, positional); break;
    case 'sweep': sweep(ctx, { yes: flag('--yes') }); break;
    default: throw new Refusal(`Unknown command: ${command}. Use init, status, take, release, mode or sweep.`);
  }
} catch (error) {
  log(error.message);
  process.exit(error instanceof Refusal ? 2 : 1);
}
