#!/usr/bin/env node
// PostToolUse hook: collapses long, successful verification output to the lines that
// carry signal, so a green test run does not push the useful context out of the window.
//
// The decision is driven by the OUTPUT, not by a list of command names. A list can
// never keep up with make, gradle, electron-builder, uv, bazel and whatever comes next;
// a runner summary, on the other hand, looks like a runner summary in every stack.
// The command list survives only as a fast path.
//
// Anything that looks like a failure is passed through untouched. Losing evidence on a
// red run is far more expensive than a few thousand tokens on a green one.

const MIN_LINES = 180;
const MIN_CHARS = 14_000;
const HEAD_LINES = 20;
const TAIL_LINES = 45;
const CONTEXT_BEFORE = 2;
const CONTEXT_AFTER = 5;
const MAX_KEPT_LINES = 280;

// Output that reads as a test/lint/build runner, in any ecosystem.
const RUNNER_OUTPUT =
  /(?:^|\n)\s*(?:Test Files\s+\d|Tests?:\s+\d|Test Suites:|Snapshots:|collected \d+ items|=+ .*\b(?:passed|failed|skipped)\b.*=+|test result: (?:ok|FAILED)|ok\s+\S+\s+[\d.]+s|PASS\s|FAIL\s|\d+ passed\b|\d+ problems? \(|Successfully ran target|NX\s{2,}|Tasks:\s+\d+ successful|Compiled successfully|✓ Compiled|Route \(app\)|webpack \d|BUILD SUCCESSFUL|BUILD SUCCESS|\[INFO\] Tests run:|• (?:building|packaging|signing)|Done in \d)/i;

// A check mark reads as a runner only in a column of them. A single "✔ done" closing a
// file listing, or a validator's "✔ Validation passed", is not a test run.
const CHECK_LINE = /(?:^|\n)\s*(?:✓|✔|√) /g;
const MIN_CHECK_LINES = 3;

// Failure markers. Their presence disables filtering entirely. A red run can still
// reach this hook with a zero exit status — `npm test | tee log`, `... || true`, a
// runner that reports failures without failing — so the vocabulary has to be broad.
const FAILURE_OUTPUT =
  /(?:\bFAILED\b|\bFAIL\b|✕|✗|× |error TS\d+|ELIFECYCLE|npm error|Command failed|--- FAIL:|panic:|AssertionError|BUILD FAILED|BUILD FAILURE|Failures:\s*[1-9]|Errors:\s*[1-9]|Found \d+ errors?|Tests?:.*\b\d+ failed|\d+ failing|\d+ problems? \(\d*[1-9]\d* error)/;

// Fast path: a quiet runner produces no recognisable summary, so fall back to the
// command itself. Matching tokens beats one grand regex — a package manager, a task
// runner and a tool can nest in any order ("pnpm nx run-many test"), and a pattern
// that tries to anchor all of them ends up matching none.
//
// A bare verb is NOT enough: "grep -rn TODO src test" and "cd build && cmake --build ."
// both contain one, and eating a grep's output would be a real loss. A verb counts only
// when the token in front of it is something that runs tasks.
const RUNNER_TOOLS = new Set([
  'jest', 'vitest', 'mocha', 'playwright', 'cypress', 'ava',
  'eslint', 'biome', 'tsc', 'next', 'nest', 'vite', 'webpack',
  'electron-builder', 'electron-forge', 'nx', 'turbo', 'lerna',
  'pytest', 'tox', 'nox', 'mypy', 'ruff',
]);

const TASK_HOSTS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx',
  'make', 'just', 'rake', 'task', 'mage',
  'cargo', 'go', 'dotnet', 'mvn', 'gradle', 'gradlew', 'bazel', 'ctest', 'composer',
  'nx', 'turbo', 'lerna', 'uv', 'poetry', 'pipenv', 'tox',
]);

// Tokens that pass the "runs tasks" role along to what follows them.
const TRANSPARENT = new Set(['run', 'run-many', 'exec', 'dlx', 'runs']);

const RUNNER_VERBS = new Set(['test', 'tests', 'lint', 'build', 'typecheck', 'type-check', 'check', 'e2e', 'ci', 'verify']);

// Lines worth keeping inside a long run: outcomes, counts, diagnostics, timings.
const INTERESTING =
  /(FAIL|FAILED|ERROR|Error:|error TS\d+|warning|WARN|AssertionError|Expected|Received|×|✕|✓|✔|not ok|panic:|--- FAIL:|Tests?:\s|Suites?:|Test Files|Command failed|ELIFECYCLE|Typecheck|Lint|Build|passed|PASS|skipped|Done in|Finished|Successfully|problems? \()/i;

main();

async function main() {
  const input = await readInput();
  const passThrough = () => {
    process.stdout.write('{}');
    process.exit(0);
  };

  if (!applies(input)) passThrough();

  const response = input.tool_response;
  const combined = [textOf(response.stdout), textOf(response.stderr)].filter(Boolean).join('\n');
  const lines = combined.split(/\r?\n/);

  // Already small enough to be worth reading in full. Either dimension counts: a few
  // very long lines cost as much context as many short ones.
  if (lines.length <= MIN_LINES && combined.length <= MIN_CHARS) passThrough();

  // Never filter a failure — the evidence is the whole point of running the command.
  if (looksFailed(response, combined)) passThrough();

  const isVerification = looksLikeRunner(combined) || isVerificationCommand(input.tool_input.command);
  if (!isVerification) passThrough();

  const selected = selectLines(lines);
  // Nothing was dropped, so replacing the output would only add a banner to it.
  if (selected.length === lines.length) passThrough();

  const filtered =
    `[token-filter] Kept ${selected.length}/${lines.length} lines; no failure markers were detected in the full output.\n` +
    selected.join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: {
          stdout: filtered,
          stderr: '',
          interrupted: Boolean(response.interrupted),
          isImage: Boolean(response.isImage),
        },
      },
    }),
  );
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function applies(input) {
  return (
    input?.hook_event_name === 'PostToolUse' &&
    ['Bash', 'PowerShell'].includes(input?.tool_name) &&
    typeof input?.tool_input?.command === 'string' &&
    Boolean(input?.tool_response) &&
    typeof input.tool_response === 'object'
  );
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function looksLikeRunner(combined) {
  if (RUNNER_OUTPUT.test(combined)) return true;
  let checks = 0;
  for (const _ of combined.matchAll(CHECK_LINE)) {
    checks += 1;
    if (checks >= MIN_CHECK_LINES) return true;
  }
  return false;
}

function looksFailed(response, combined) {
  if (response.is_error === true || response.interrupted === true) return true;
  return FAILURE_OUTPUT.test(combined);
}

function isVerificationCommand(command) {
  let hosted = false; // is the token in front of us something that runs tasks?

  for (const token of String(command).split(/[\s&;|()]+/)) {
    if (token === '' || token.startsWith('-')) continue; // flags carry no role

    const bare = token.replace(/^.*[/\\]/, '').toLowerCase(); // ./node_modules/.bin/jest -> jest
    if (RUNNER_TOOLS.has(bare)) return true;
    if (hosted && RUNNER_VERBS.has(bare.split(':')[0])) return true; // "pnpm test:unit"

    hosted = TASK_HOSTS.has(bare) || (hosted && TRANSPARENT.has(bare));
  }

  return false;
}

function selectLines(lines) {
  const head = indexRange(0, Math.min(HEAD_LINES, lines.length));
  // The tail carries the final summary — the single most valuable part of a long run.
  // It is reserved before the budget is spent, so capping can never truncate it away.
  const tail = indexRange(Math.max(0, lines.length - TAIL_LINES), lines.length);

  const reserved = new Set([...head, ...tail]);
  const budget = MAX_KEPT_LINES - reserved.size;

  const middle = new Set();
  for (let i = 0; i < lines.length && middle.size < budget; i += 1) {
    if (!INTERESTING.test(lines[i])) continue;
    const from = Math.max(0, i - CONTEXT_BEFORE);
    const to = Math.min(lines.length - 1, i + CONTEXT_AFTER);
    for (let j = from; j <= to; j += 1) {
      if (!reserved.has(j)) middle.add(j);
    }
  }

  return [...new Set([...reserved, ...[...middle].slice(0, Math.max(0, budget))])]
    .sort((a, b) => a - b)
    .map((i) => lines[i]);
}

function indexRange(from, to) {
  const out = [];
  for (let i = from; i < to; i += 1) out.push(i);
  return out;
}
