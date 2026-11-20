// The per-repository workspace config, read by the hooks without spawning git.
// bin/workspace.mjs owns the full format; the hooks need the mode, the protected paths
// and — in branch mode — which branches must not be edited directly.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonical, overlayDir } from './repo.mjs';

export const WORKSPACE_CLI = fileURLToPath(new URL('../../bin/workspace.mjs', import.meta.url));
export const MODES = ['worktrees', 'branches', 'off'];

// Who creates the worktrees in worktrees mode: the pool's own slots, or Orca — the desktop
// app that manages worktrees itself, so its sidebar, terminals and cleanup rules see them.
// "auto" asks the session: one started by Orca uses Orca, the CLI and Claude Desktop use the
// pool. Orca marks the sessions it starts in their environment.
export const PROVIDERS = ['pool', 'orca', 'auto'];

export const inOrcaSession = (env = process.env) =>
  env.CLAUDE_CODE_ENTRYPOINT === 'orca' || Boolean(env.ORCA_AGENT_SESSION_ID);

// 'pool' | 'orca' — what "auto" resolves to in this session; an unknown value is the pool.
export function activeProvider(config, env = process.env) {
  const setting = config?.provider ?? 'pool';
  if (setting === 'auto') return inOrcaSession(env) ? 'orca' : 'pool';
  return setting === 'orca' ? 'orca' : 'pool';
}

// How a pool slot is told apart from any other linked worktree — Claude Code's own, an
// IDE's, a hand-made one. The pool locks its slots with this reason, and also leaves a mark
// in the slot's folder under .git/worktrees, which still holds once someone lifts the lock.
export const LOCK_REASON = 'claudius worktree pool';
export const SLOT_MARK = 'claudius-slot';

// The worktree's own folder under <main>/.git/worktrees, read from its .git file.
export function adminDir(worktreePath) {
  try {
    const match = readFileSync(join(worktreePath, '.git'), 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
    return match ? resolve(worktreePath, match[1]) : null;
  } catch {
    return null;
  }
}

// True for a slot of the pool: the pool's lock, or the pool's mark and no other lock.
// Reads files only, so the hooks can ask it without spawning git.
export function isPoolSlot(worktreePath) {
  const dir = adminDir(worktreePath);
  if (dir === null) return false;
  let lock = null;
  try {
    lock = readFileSync(join(dir, 'locked'), 'utf8').trim();
  } catch {
    /* not locked */
  }
  return lock === null ? existsSync(join(dir, SLOT_MARK)) : lock === LOCK_REASON;
}

export const configPath = (mainTree) => join(overlayDir(mainTree), 'workspace.json');

// Nobody is signed up for a workflow they did not choose. The whole feature stays inert
// unless a repository has a workspace.json, and even then `"mode": "off"` (per repository)
// or CLAUDIUS_WORKSPACE=off (everywhere) silences it without deleting anything.
export const disabledEverywhere = () => process.env.CLAUDIUS_WORKSPACE === 'off';

// The overlay folder is named after the main tree's basename, which a cloned repository
// chooses — so a config only applies to the repository it names in "main". A config without
// "main" predates the binding and applies to nobody until its owner adds it.
//
// 'bound' | 'unbound' (no "main") | 'foreign' (another repository's config)
export function configBinding(config, mainTree) {
  if (typeof config?.main !== 'string' || config.main === '') return 'unbound';
  return canonical(config.main) === mainTree ? 'bound' : 'foreign';
}

function parseConfig(mainTree) {
  if (disabledEverywhere()) return null;
  const path = configPath(mainTree);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// The parsed workspace.json for a main tree, or null when the feature does not apply:
// not opted in, switched off, unreadable, or not bound to this repository — a broken or
// borrowed config must never block editing.
export function readWorkspaceConfig(mainTree) {
  const config = parseConfig(mainTree);
  if (!config || configBinding(config, mainTree) !== 'bound') return null;
  const mode = MODES.includes(config.mode) ? config.mode : 'worktrees';
  return mode === 'off' ? null : { ...config, mode };
}

// True when this repository's config exists but predates the binding to a repository.
export function hasUnboundConfig(mainTree) {
  const config = parseConfig(mainTree);
  return Boolean(config) && config.mode !== 'off' && configBinding(config, mainTree) === 'unbound';
}

// The line that binds a config to a repository, exactly as it goes into workspace.json.
export const bindingLine = (mainTree) => `"main": ${JSON.stringify(mainTree)}`;

export function workspaceCommand(args) {
  return `node "${WORKSPACE_CLI}" ${args}`;
}

// Branches that are shared ground: the base the config names ("origin/release/*" →
// "release/*") plus the usual defaults, unless the config lists its own.
export function protectedBranches(config) {
  if (Array.isArray(config.protectedBranches)) return config.protectedBranches;
  const fromBase = typeof config.base === 'string' ? [config.base.replace(/^[^/]+\//, '')] : [];
  return [...new Set([...fromBase, 'main', 'master'])];
}

const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

export function matchesAny(branch, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(branch));
}

// The branch checked out in a main tree, read from .git/HEAD; null when detached.
export function currentBranch(mainTree) {
  try {
    // In a linked worktree `.git` is a file naming its admin folder, where its own HEAD lives.
    let gitDir = join(mainTree, '.git');
    if (statSync(gitDir).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, 'utf8'))?.[1]?.trim();
      if (!pointer) return null;
      gitDir = isAbsolute(pointer) ? pointer : resolve(mainTree, pointer);
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null;
  } catch {
    return null;
  }
}
