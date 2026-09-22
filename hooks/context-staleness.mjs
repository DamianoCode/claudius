#!/usr/bin/env node
// SessionStart hook: warns when the private overlay ~/.claude/context/<repo>/PROJECT.md
// is older than the files it was derived from.
//
// Silent when there is no overlay at all. An absent overlay is a choice, not a problem,
// and a reminder printed on every single session start is noise rather than signal.
// Writes nothing and never blocks session start.

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

import { locateRepo, overlayDir } from './lib/repo.mjs';

// Files the overlay draws its facts from. Fixed list plus tracked schemas and rules —
// cheap, because git ls-files is indexed and we stat only a few dozen paths.
const MANIFESTS = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'nx.json',
  'turbo.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
];

const TRACKED_GLOBS = ['*.prisma', '.claude/rules/*.md', '*.config.ts'];
const TRACKED_LIMIT = 120;
const SHOWN = 3;

const quit = () => process.exit(0);

const cwd = readCwd();
const root = gitRoot(cwd);
if (!root) quit(); // not a repository — not our business

// Named after the main working tree, so a linked worktree finds the same overlay.
const main = locateRepo(root)?.main ?? root;
const repo = basename(main);
const overlay = join(overlayDir(main), 'PROJECT.md');
if (!existsSync(overlay)) quit();

const overlayMtime = statSync(overlay).mtimeMs;
const newer = sourcesNewerThan(root, overlayMtime);
if (newer.length === 0) quit();

const days = Math.round((Date.now() - overlayMtime) / 86_400_000);
const shown = newer.slice(0, SHOWN).join(', ');
const rest = newer.length > SHOWN ? ` (+${newer.length - SHOWN})` : '';

console.log(
  `[context] The overlay ~/.claude/context/${repo}/PROJECT.md is ${days} day(s) old and older than: ${shown}${rest}. ` +
    `Refresh it with /claudius:project-profile if the stack, commands or rules have changed. The file itself may still be correct.`,
);

function readCwd() {
  // Hook input arrives as JSON on stdin; prefer its cwd when present.
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8'));
    if (parsed && typeof parsed.cwd === 'string' && parsed.cwd !== '') return parsed.cwd;
  } catch {
    /* no input or not JSON — fall back to the process cwd */
  }
  return process.cwd();
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function gitRoot(cwd) {
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']) || '';
  } catch {
    return '';
  }
}

function sourcesNewerThan(root, mtime) {
  let tracked = [];
  try {
    tracked = git(root, ['ls-files', ...TRACKED_GLOBS])
      .split('\n')
      .filter(Boolean)
      .slice(0, TRACKED_LIMIT); // hard cap, so the hook never becomes expensive
  } catch {
    /* no matches */
  }

  const newer = [];
  for (const rel of [...MANIFESTS, ...tracked]) {
    try {
      if (statSync(join(root, rel)).mtimeMs > mtime) newer.push(rel);
    } catch {
      /* file absent — skip */
    }
  }
  return newer;
}
