// Behavior tests for hooks/filter-verification-output.mjs (PostToolUse).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runHook, runHookRaw } from './helpers.mjs';

const HOOK = 'filter-verification-output.mjs';

function benignFillerLines(count) {
  const lines = [];
  for (let i = 0; i < count; i += 1) lines.push(`processing work item ${i} of ${count} ...`);
  return lines;
}

function bashInput({ command, stdout, stderr = '', is_error = false, interrupted = false, hookEventName = 'PostToolUse', toolName = 'Bash' }) {
  return {
    hook_event_name: hookEventName,
    tool_name: toolName,
    tool_input: { command },
    tool_response: { stdout, stderr, is_error, interrupted, isImage: false },
  };
}

// --- input hygiene ---

test('returns no-op {} for malformed JSON on stdin', () => {
  const result = runHookRaw(HOOK, '{not valid json');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns no-op {} for empty stdin', () => {
  const result = runHookRaw(HOOK, '');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns no-op {} for a wrong hook_event_name even with an otherwise well-formed payload', () => {
  const result = runHook(HOOK, bashInput({ command: 'npm test', stdout: benignFillerLines(250).join('\n'), hookEventName: 'PreToolUse' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

// --- pass-through cases ---

test('returns {} for short output', () => {
  const result = runHook(HOOK, bashInput({ command: 'npm test', stdout: 'ok\n' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns {} for a non-Bash/PowerShell tool even with long verification-looking output', () => {
  const summary = ['Test Files  12 passed (12)', 'Tests  84 passed (84)', ...benignFillerLines(200)].join('\n');
  const result = runHook(HOOK, bashInput({ command: 'npm test', stdout: summary, toolName: 'Read' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns {} for long output that does not look like verification', () => {
  const body = benignFillerLines(250).join('\n');
  const result = runHook(HOOK, bashInput({ command: 'cat notes.txt', stdout: body }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns {} for long output containing failure markers, even though it looks like a runner summary', () => {
  const body = ['Test Files  1 failed (1)', 'Tests  1 failed, 3 passed', 'FAILED  src/x.test.js', ...benignFillerLines(200)].join('\n');
  const result = runHook(HOOK, bashInput({ command: 'npm test', stdout: body }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns {} for long output containing a TypeScript error marker', () => {
  const body = ['src/x.ts(10,5): error TS1234: Something is wrong.', ...benignFillerLines(200)].join('\n');
  const result = runHook(HOOK, bashInput({ command: 'tsc --noEmit', stdout: body }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

test('returns {} for long output containing a failing-mark symbol (✕)', () => {
  const body = ['✕ something broke', ...benignFillerLines(200)].join('\n');
  const result = runHook(HOOK, bashInput({ command: 'npm test', stdout: body }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{}');
});

// --- filtering: driven by output content ---

function assertFiltered(result, inputLineCount) {
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput']);
  const hso = parsed.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PostToolUse');
  assert.deepEqual(Object.keys(hso).sort(), ['hookEventName', 'updatedToolOutput'].sort());
  const uto = hso.updatedToolOutput;
  assert.deepEqual(Object.keys(uto).sort(), ['interrupted', 'isImage', 'stdout', 'stderr'].sort());
  assert.equal(typeof uto.stdout, 'string');
  assert.ok(uto.stdout.startsWith('[token-filter]'));
  assert.equal(uto.stderr, '');
  assert.equal(typeof uto.interrupted, 'boolean');
  assert.equal(typeof uto.isImage, 'boolean');

  const keptLines = uto.stdout.split('\n').length;
  assert.ok(keptLines < inputLineCount, `expected filtered output (${keptLines} lines) to be smaller than input (${inputLineCount} lines)`);
}

test('filters a long successful vitest-style summary', () => {
  const lines = [
    '$ vitest run',
    'RUN  v1.4.0',
    ...benignFillerLines(200),
    'Test Files  12 passed (12)',
    'Tests  84 passed (84)',
    'Duration  5.23s',
  ];
  const result = runHook(HOOK, bashInput({ command: 'npx vitest run', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

test('filters a long successful pytest-style summary', () => {
  const lines = [
    '$ pytest',
    'collected 84 items',
    ...benignFillerLines(200),
    '==================== 84 passed in 1.23s ====================',
  ];
  const result = runHook(HOOK, bashInput({ command: 'python3 -m pytest', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

test('filters a long BUILD SUCCESSFUL gradle-style log', () => {
  const lines = [
    '$ ./gradlew build',
    ...benignFillerLines(200),
    'BUILD SUCCESSFUL in 42s',
    '12 actionable tasks: 12 executed',
  ];
  const result = runHook(HOOK, bashInput({ command: './gradlew build', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

test('filters a long electron-builder-style log', () => {
  const lines = [
    '$ electron-builder',
    '• electron-builder  version=24.0.0',
    ...benignFillerLines(200),
    '• building        target=nsis file=dist/App-Setup.exe',
    '• signing          file=dist/App-Setup.exe',
  ];
  const result = runHook(HOOK, bashInput({ command: 'npx electron-builder', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

// --- filtering: fast path driven by the command, even with unremarkable output ---

test('filters unremarkable long output when the command matches the fast path (pnpm nx test)', () => {
  // Package manager, task runner and tool nest in any order. Token matching handles
  // "pnpm nx test my-app" and a bare "nx test" alike; an anchored regex handled neither.
  const lines = benignFillerLines(220);
  const result = runHook(HOOK, bashInput({ command: 'pnpm nx test my-app', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

test('filters a bare nx invocation as well as a package-manager-prefixed one', () => {
  const lines = benignFillerLines(220);
  const result = runHook(HOOK, bashInput({ command: 'nx run-many -t test', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

test('filters unremarkable long output when the command matches the fast path (npx tsc)', () => {
  const lines = benignFillerLines(220);
  const result = runHook(HOOK, bashInput({ command: 'npx tsc --noEmit', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

test('filters unremarkable long output when the command matches the fast path (make test)', () => {
  const lines = benignFillerLines(220);
  const result = runHook(HOOK, bashInput({ command: 'make test', stdout: lines.join('\n') }));
  assertFiltered(result, lines.length);
});

// --- the summary must survive capping ---

test('keeps the final summary even when every line is interesting and the cap binds', () => {
  // A run where every line matches the "interesting" pattern is the case that exposes a
  // naive cap: taking the first N kept indexes drops the tail, which is exactly where the
  // runner prints the one line a reader actually needs.
  const body = [];
  for (let i = 0; i < 2000; i += 1) body.push(`  ✓ src/mod-${i}.spec.ts > passed`);
  const summary = 'Test Files  84 passed (84)';
  const all = [...body, summary];

  const result = runHook(HOOK, bashInput({ command: 'pnpm run test', stdout: all.join('\n') }));
  const kept = JSON.parse(result.stdout).hookSpecificOutput.updatedToolOutput.stdout;

  assert.ok(kept.includes(summary), 'the final summary line must survive the cap');
  assert.ok(kept.trimEnd().endsWith(summary), 'the summary must still be the last kept line');
});


// --- a verb in the command line is not a verification run ---

test('returns {} for a long grep whose arguments merely contain the word "test"', () => {
  // Regression: token matching once accepted any command containing test/build/check,
  // so a grep with 300 hits had 235 of them silently thrown away.
  const lines = benignFillerLines(300);
  const result = runHook(HOOK, bashInput({ command: 'grep -rn TODO src test', stdout: lines.join('\n') }));
  assert.equal(result.stdout, '{}');
});

test('returns {} for a long build-directory command that never invokes a task runner', () => {
  const lines = benignFillerLines(300);
  const result = runHook(HOOK, bashInput({ command: 'cd build && cmake --build .', stdout: lines.join('\n') }));
  assert.equal(result.stdout, '{}');
});

// --- failures the exit status does not reveal ---

test('returns {} when the tool response is flagged as an error', () => {
  const lines = benignFillerLines(300);
  const result = runHook(HOOK, bashInput({ command: 'pnpm run test', stdout: lines.join('\n'), is_error: true }));
  assert.equal(result.stdout, '{}');
});

test('returns {} when the command was interrupted', () => {
  const lines = benignFillerLines(300);
  const result = runHook(HOOK, bashInput({ command: 'pnpm run test', stdout: lines.join('\n'), interrupted: true }));
  assert.equal(result.stdout, '{}');
});

test('returns {} for a Maven run that reports BUILD FAILURE with a zero exit status', () => {
  // A red run reaches this hook green often enough: `npm test | tee log`, `... || true`,
  // or a runner that reports failures without failing. The vocabulary has to catch it.
  const body = ['[INFO] Tests run: 12, Failures: 2, Errors: 0', ...benignFillerLines(250), '[INFO] BUILD FAILURE'];
  const result = runHook(HOOK, bashInput({ command: 'mvn verify', stdout: body.join('\n') }));
  assert.equal(result.stdout, '{}');
});

test('returns {} for a type checker that reports errors without failing', () => {
  const body = [...benignFillerLines(250), 'Found 250 errors in 42 files (checked 300 source files)'];
  const result = runHook(HOOK, bashInput({ command: 'uv run mypy .', stdout: body.join('\n') }));
  assert.equal(result.stdout, '{}');
});

// --- never replace output with a longer version of itself ---

test('returns {} when the output is long in characters but has nothing to drop', () => {
  // Three enormous lines pass the size gate, but head and tail already cover all three,
  // so "filtering" would only prepend a banner to output nobody shortened.
  const lines = [1, 2, 3].map((i) => `line ${i} ` + 'x'.repeat(20000));
  const result = runHook(HOOK, bashInput({ command: 'pnpm run test', stdout: lines.join('\n') }));
  assert.equal(result.stdout, '{}');
});
