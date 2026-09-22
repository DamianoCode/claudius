#!/usr/bin/env node
// PreToolUse hook (Edit|Write|NotebookEdit): keeps edits to a repository's protected
// paths off shared ground, in whichever mode its workspace config names.
//
//   worktrees — the main working tree is shared by parallel sessions, so edits there are
//               refused and the agent is sent to claim a worktree slot.
//   branches  — sessions work in the main tree itself, so edits are refused only while it
//               sits on a protected branch (the base, main, master) or a detached HEAD.
//
// A rule in a prompt is forgotten; a refusal carrying the next command is not. Silent
// everywhere else: no config, a linked worktree, an unprotected path, or
// CLAUDIUS_ALLOW_MAIN_TREE=1. Runs on every edit, so it never spawns a process.

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { locateRepo } from './lib/repo.mjs';
import {
  currentBranch, matchesAny, protectedBranches, readWorkspaceConfig, workspaceCommand,
} from './lib/workspace.mjs';

const allow = () => process.exit(0);

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  allow();
}

if (process.env.CLAUDIUS_ALLOW_MAIN_TREE === '1') allow();

const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (typeof target !== 'string' || target === '') allow();

const file = isAbsolute(target) ? target : resolve(input.cwd ?? process.cwd(), target);
const repo = locateRepo(file);
if (!repo || repo.linked) allow();

const config = readWorkspaceConfig(repo.main);
const protect = Array.isArray(config?.protect) ? config.protect : [];
if (protect.length === 0) allow();

const rel = relative(repo.main, file).split(sep).join('/');
const hit = protect.find((prefix) => {
  const clean = prefix.replace(/^\.?\/+/, '');
  return clean === '' || clean === '.' || rel === clean.replace(/\/$/, '') || rel.startsWith(clean.endsWith('/') ? clean : `${clean}/`);
});
if (!hit) allow();

let reason;
if (config.mode === 'branches') {
  const branch = currentBranch(repo.main);
  if (branch && !matchesAny(branch, protectedBranches(config))) allow();
  reason =
    `${rel} would be edited on ${branch ?? 'a detached HEAD'}, which this repository keeps free of direct work. ` +
    `Start a branch first: ${workspaceCommand('take <branch-name>')} — it switches this checkout — then make the edit. ` +
    `When the work is pushed: ${workspaceCommand('release')}.`;
} else {
  reason =
    `${rel} is in the main working tree, which this repository keeps free of edits (protected: ${protect.join(', ')}). ` +
    `Claim a worktree slot: ${workspaceCommand('take <branch-name>')} — the last line it prints is the slot path; ` +
    `then switch into it with the EnterWorktree tool (path: that slot) and make the same edit there. ` +
    `When the work is pushed: ${workspaceCommand('release')} from inside the slot, then ExitWorktree (action: keep).`;
}

console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
}));
