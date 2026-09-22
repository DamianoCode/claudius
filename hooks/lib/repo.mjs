// Where a path's repository really lives, resolved without spawning git.
//
// Linked worktrees (`git worktree add`) have their own top-level directory, so
// `git rev-parse --show-toplevel` names the worktree — "slot-2", "feature-x" — and a
// private overlay keyed by that name is never found. Every worktree shares the main
// working tree's `.git` directory, though, and that is the stable identity.
//
// Kept free of child processes because the PreToolUse guard runs this on every edit.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// One spelling per directory, so paths from git, from Claude Code and from the user
// compare equal. Windows hands out the same folder as C:\Users\RUNNER~1\… and as
// C:\Users\runneradmin\…, or with a different drive-letter case; git always reports the
// long form. A path that does not exist yet is spelled from its nearest existing parent.
export function canonical(path) {
  let existing = resolve(path);
  const missing = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    missing.unshift(basename(existing));
    existing = parent;
  }
  try {
    return join(realpathSync.native(existing), ...missing);
  } catch {
    return resolve(path);
  }
}

// Nearest ancestor of `start` (inclusive) that contains a `.git` entry, or null.
function findGitEntry(start) {
  let dir = canonical(start);
  for (;;) {
    const entry = join(dir, '.git');
    if (existsSync(entry)) return { dir, entry };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// { worktree, main, linked } for the repository containing `start`, or null outside one.
// `worktree` is the checkout `start` sits in; `main` is the main working tree.
export function locateRepo(start) {
  const found = findGitEntry(start);
  if (!found) return null;

  if (statSync(found.entry).isDirectory()) {
    return { worktree: found.dir, main: found.dir, linked: false };
  }

  // A linked worktree's `.git` is a file: "gitdir: <main>/.git/worktrees/<name>".
  const match = readFileSync(found.entry, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
  if (!match) return null;
  const gitdir = isAbsolute(match[1]) ? match[1] : resolve(found.dir, match[1]);
  const commonDir = resolve(gitdir, '..', '..');
  if (basename(commonDir) !== '.git') return null; // submodule or unusual layout — not ours to guess
  return { worktree: found.dir, main: canonical(dirname(commonDir)), linked: true };
}

// ~/.claude/context/<main-tree-basename>/ — the same folder from every worktree.
export function overlayDir(mainTree) {
  return join(homedir(), '.claude', 'context', basename(mainTree));
}
