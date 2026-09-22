#!/usr/bin/env node
// SessionStart hook: in a repository with a workspace config, says in one line how work
// is isolated here and where this session stands — so the agent starts right instead of
// learning it from a refused edit. Silent when the repository has not opted in.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { locateRepo } from './lib/repo.mjs';
import { currentBranch, readWorkspaceConfig, workspaceCommand } from './lib/workspace.mjs';

let cwd = process.cwd();
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (typeof input?.cwd === 'string' && input.cwd !== '') cwd = input.cwd;
} catch {
  /* no input — fall back to the process cwd */
}

const repo = locateRepo(cwd);
const config = repo && readWorkspaceConfig(repo.main);
if (!config) process.exit(0);

const name = basename(repo.main);
let line;
if (repo.linked) {
  line =
    `This session runs in the worktree ${basename(repo.worktree)} of ${name}. ` +
    `When its work is pushed, free it with: ${workspaceCommand('release')}, then ExitWorktree (action: keep).`;
} else if (config.mode === 'branches') {
  line =
    `${name} works on branches in this checkout (currently ${currentBranch(repo.main) ?? 'detached'}). ` +
    `Before changing code: ${workspaceCommand('take <branch-name>')}; when pushed: ${workspaceCommand('release')}. ` +
    `Parallel sessions share this checkout — switch to worktrees mode for them: ${workspaceCommand('mode worktrees')}`;
} else {
  line =
    `${name} uses a worktree pool; code is not edited in the main tree. ` +
    `Before changing code: ${workspaceCommand('take <branch-name>')}, then switch into the printed path with the EnterWorktree tool (path: …). ` +
    `Status: ${workspaceCommand('status')}`;
}
console.log(`[workspace] ${line}`);
