// The per-repository workspace config, read by the hooks without spawning git.
// bin/workspace.mjs owns the full format; the hooks need the mode, the protected paths
// and — in branch mode — which branches must not be edited directly.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { overlayDir } from './repo.mjs';

export const WORKSPACE_CLI = fileURLToPath(new URL('../../bin/workspace.mjs', import.meta.url));
export const MODES = ['worktrees', 'branches', 'off'];

export const configPath = (mainTree) => join(overlayDir(mainTree), 'workspace.json');

// Nobody is signed up for a workflow they did not choose. The whole feature stays inert
// unless a repository has a workspace.json, and even then `"mode": "off"` (per repository)
// or CLAUDIUS_WORKSPACE=off (everywhere) silences it without deleting anything.
export const disabledEverywhere = () => process.env.CLAUDIUS_WORKSPACE === 'off';

// The parsed workspace.json for a main tree, or null when the feature does not apply:
// not opted in, switched off, or unreadable — a broken config must never block editing.
export function readWorkspaceConfig(mainTree) {
  if (disabledEverywhere()) return null;
  const path = configPath(mainTree);
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    const mode = MODES.includes(config.mode) ? config.mode : 'worktrees';
    return mode === 'off' ? null : { ...config, mode };
  } catch {
    return null;
  }
}

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
    const head = readFileSync(join(mainTree, '.git', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null;
  } catch {
    return null;
  }
}
