#!/usr/bin/env node
// SessionStart hook: in a repository with a workspace config, says in one line how work
// is isolated here and where this session stands — so the agent starts right instead of
// learning it from a refused edit. Silent when the repository has not opted in.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { locateRepo } from './lib/repo.mjs';
import {
  activeProvider, bindingLine, configPath, currentBranch, hasUnboundConfig, isPoolSlot, readWorkspaceConfig,
  workspaceCommand,
} from './lib/workspace.mjs';

let cwd = process.cwd();
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (typeof input?.cwd === 'string' && input.cwd !== '') cwd = input.cwd;
} catch {
  /* no input — fall back to the process cwd */
}

const repo = locateRepo(cwd);
const config = repo && readWorkspaceConfig(repo.main);
if (!config) {
  // A config from before the binding is inert, and its owner would otherwise only learn
  // that from a refused command.
  if (repo && hasUnboundConfig(repo.main)) {
    console.log(
      `[workspace] ${configPath(repo.main)} does not say which repository it belongs to, so it is ignored. ` +
        `If it was made for this one, add ${bindingLine(repo.main)} to it.`,
    );
  }
  process.exit(0);
}

const name = basename(repo.main);
const orca = config.mode === 'worktrees' && activeProvider(config) === 'orca';
let line;
if (repo.linked && orca && !isPoolSlot(repo.worktree)) {
  line =
    `This session runs in the worktree ${basename(repo.worktree)} of ${name}. Work here as usual; ` +
    `it stays until its pull request merges, then ${workspaceCommand('sweep')} or Orca's cleanup removes it.`;
} else if (repo.linked && !isPoolSlot(repo.worktree)) {
  // Claude Code's own worktree, an IDE's, a hand-made one: the pool neither made it nor
  // frees it, so release would only refuse here.
  line =
    `This session runs in the worktree ${basename(repo.worktree)} of ${name}, which is not a slot of its pool. ` +
    'Work here as usual; the tool that created it also cleans it up.';
} else if (repo.linked) {
  line =
    `This session runs in the worktree ${basename(repo.worktree)} of ${name}. ` +
    `When its work is pushed, free it with: ${workspaceCommand('release')}, then ExitWorktree (action: keep).`;
} else if (config.mode === 'branches') {
  line =
    `${name} works on branches in this checkout (currently ${currentBranch(repo.main) ?? 'detached'}). ` +
    `Before changing code: ${workspaceCommand('take <branch-name>')}; when pushed: ${workspaceCommand('release')}. ` +
    `Parallel sessions share this checkout — switch to worktrees mode for them: ${workspaceCommand('mode worktrees')}`;
} else if (orca) {
  line =
    `${name} works in Orca worktrees; code is not edited in the main tree. ` +
    `Before changing code: ${workspaceCommand('take <branch-name>')} — it creates the worktree through Orca — ` +
    `then switch into the printed path with the EnterWorktree tool (path: …). ` +
    `Status: ${workspaceCommand('status')}`;
} else {
  line =
    `${name} uses a worktree pool; code is not edited in the main tree. ` +
    `Before changing code: ${workspaceCommand('take <branch-name>')}, then switch into the printed path with the EnterWorktree tool (path: …). ` +
    `Status: ${workspaceCommand('status')}`;
}
console.log(`[workspace] ${line}`);
