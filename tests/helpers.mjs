// Shared test infrastructure: spawning a hook as a real child process, building
// throwaway temp dirs/transcripts, and never touching the developer's real
// ~/.claude/context or the machine's git config.

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..');
export const HOOKS_DIR = join(REPO_ROOT, 'hooks');

export function hookPath(name) {
  return join(HOOKS_DIR, name);
}

// Hooks run top-level code and call process.exit — importing them directly would
// terminate the test runner. A subprocess is the honest seam: it matches exactly
// how Claude Code invokes them (JSON on stdin, exit code + stdout/stderr as contract).
export function runHookRaw(name, stdin, opts = {}) {
  const result = spawnSync(process.execPath, [hookPath(name)], {
    input: stdin,
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    timeout: opts.timeout,
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
    signal: result.signal,
  };
}

export function runHook(name, input, opts = {}) {
  return runHookRaw(name, JSON.stringify(input), opts);
}

// What the SubagentStop guard asked of the agent: the feedback it sent through
// additionalContext, or '' when it let the agent stop. The guard never fails the hook
// itself, so any exit status other than 0 is an error here.
export function stopContinuation(result) {
  if (result.status !== 0) throw new Error(`the guard must exit 0, got ${result.status}: ${result.stderr}`);
  if (result.stdout === '') return '';
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  if (output?.hookEventName !== 'SubagentStop') throw new Error(`unexpected guard output: ${result.stdout}`);
  return output.additionalContext;
}

// Spelled the way git reports it: a runner's temp dir can be an 8.3 short path
// (C:\Users\RUNNER~1\…) that git would print in its long form.
export function makeTmpDir(prefix) {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

// Runs `fn` with a throwaway directory, removed however `fn` ends.
export function withTmpDir(prefix, fn) {
  const dir = makeTmpDir(prefix);
  try {
    return fn(dir);
  } finally {
    removeDir(dir);
  }
}

export function removeDir(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

export function writeJsonl(path, objects) {
  writeFileSync(path, objects.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  return path;
}

export function writeTranscript(dir, objects, name = 'transcript.jsonl') {
  return writeJsonl(join(dir, name), objects);
}

export function touch(path, mtimeMs) {
  const seconds = (mtimeMs ?? Date.now()) / 1000;
  utimesSync(path, seconds, seconds);
}

// Points os.homedir() at a throwaway directory inside the child process, so the
// context-staleness hook never sees the developer's real ~/.claude/context.
// Confirmed working on Windows: node's os.homedir() reads USERPROFILE there.
//
// Returns only the override keys (not a full process.env copy) so this composes
// safely with other env-override helpers via object spread in either order.
export function envWithHome(homeDir, extra = {}) {
  return { HOME: homeDir, USERPROFILE: homeDir, ...extra };
}

// Stops git's upward directory search at `boundary`, so a temp dir that happens to
// sit under a real repo (or under one created earlier in the same test run) is not
// mistaken for being inside one. GIT_CEILING_DIRECTORIES is a plain path list —
// one entry is enough here. Override-keys-only, same composition reason as above.
export function envNoRepoAbove(boundary, extra = {}) {
  return { GIT_CEILING_DIRECTORIES: boundary, ...extra };
}

// Combines process.env with any number of override-key objects, applied in order.
export function envWith(...overrides) {
  return Object.assign({}, process.env, ...overrides);
}

export function initGitRepo(dir) {
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  return dir;
}

export function writeOverlay(homeDir, repoName, mtimeMs) {
  const dir = join(homeDir, '.claude', 'context', repoName);
  mkdirSync(dir, { recursive: true });
  const overlay = join(dir, 'PROJECT.md');
  writeFileSync(overlay, '# overlay\n', 'utf8');
  if (mtimeMs != null) touch(overlay, mtimeMs);
  return overlay;
}

// A JSONL line containing an Edit tool_use, matching the shape the guard's
// transcript scanner recognizes: a "tool_use" entry with name "Edit".
export function editToolLine(extra = {}) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/x.js' }, ...extra }],
    },
  };
}

// A JSONL line containing a shell tool_use running `command`.
export function shellToolLine(command, name = 'Bash') {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name, input: { command } }],
    },
  };
}

export function assistantTextLine(text) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

// Builds a transcript of at least `minBytes`. With `withEdit`, the first line already
// contains an Edit tool_use; without it, the file contains no tool use at all — which
// is what a scan-limit test needs, since the answer then depends on reading everything.
export function buildLargeTranscript(path, minBytes, { withEdit = true } = {}) {
  const fillerEntry = JSON.stringify(assistantTextLine('x'.repeat(200))) + '\n';
  const batch = fillerEntry.repeat(4000);

  const fd = openSync(path, 'w');
  try {
    let written = 0;
    if (withEdit) {
      const firstLine = JSON.stringify(editToolLine()) + '\n';
      writeSync(fd, firstLine);
      written += Buffer.byteLength(firstLine);
    }
    while (written < minBytes) {
      writeSync(fd, batch);
      written += Buffer.byteLength(batch);
    }
  } finally {
    closeSync(fd);
  }
  return path;
}
