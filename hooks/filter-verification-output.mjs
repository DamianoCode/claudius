#!/usr/bin/env node

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  process.stdout.write('{}');
  process.exit(0);
}

const toolName = input?.tool_name;
const command = input?.tool_input?.command;
const response = input?.tool_response;

if (
  input?.hook_event_name !== 'PostToolUse' ||
  !['Bash', 'PowerShell'].includes(toolName) ||
  typeof command !== 'string' ||
  !response || typeof response !== 'object'
) {
  process.stdout.write('{}');
  process.exit(0);
}

// Filter only common verification commands, and only after successful tool execution.
// Failed shell commands go through PostToolUseFailure and retain Claude Code's error evidence.
const verification = /(?:^|(?:&&|;|\|)\s*)(?:npm\s+(?:run\s+)?(?:test|lint|build|typecheck)(?::[\w.-]+)?\b|pnpm\s+(?:(?:run\s+)?(?:test|lint|build|typecheck)(?::[\w.-]+)?|exec\s+(?:jest|vitest|eslint|tsc))\b|yarn\s+(?:run\s+)?(?:test|lint|build|typecheck)(?::[\w.-]+)?\b|bun\s+test\b|npx\s+(?:jest|vitest|eslint|tsc)\b|npx\s+nx\s+(?:test|lint|build|typecheck)\b|nx\s+(?:test|lint|build|typecheck)\b|pytest\b|python(?:3)?\s+-m\s+pytest\b|go\s+test\b|cargo\s+test\b|dotnet\s+(?:test|build)\b)/i.test(command.trim());

if (!verification) {
  process.stdout.write('{}');
  process.exit(0);
}

const stdout = typeof response.stdout === 'string' ? response.stdout : '';
const stderr = typeof response.stderr === 'string' ? response.stderr : '';
const combined = [stdout, stderr].filter(Boolean).join('\n');
const lines = combined.split(/\r?\n/);

// Keep complete output when it is already reasonably small.
if (lines.length <= 180 && combined.length <= 14000) {
  process.stdout.write('{}');
  process.exit(0);
}

const interesting = /(FAIL|FAILED|ERROR|Error:|error TS\d+|warning|WARN|AssertionError|Expected|Received|×|✕|not ok|panic:|--- FAIL:|Tests?:.*failed|Suites?:.*failed|Command failed|ELIFECYCLE|Typecheck|Lint|Build|Test Files|Tests\s+\d+|passed|PASS|Done in|Finished)/i;
const keep = new Set();

// Preserve head for command/tool summaries.
for (let i = 0; i < Math.min(20, lines.length); i += 1) keep.add(i);

for (let i = 0; i < lines.length; i += 1) {
  if (!interesting.test(lines[i])) continue;
  for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 5); j += 1) keep.add(j);
}

// Preserve tail for final runner summary/exit-like status lines.
for (let i = Math.max(0, lines.length - 45); i < lines.length; i += 1) keep.add(i);

const indexes = [...keep].sort((a, b) => a - b).slice(0, 280);
const selected = indexes.map((i) => lines[i]);
const filtered = `[token-filter] Verification output reduced to ${selected.length}/${lines.length} lines; successful command output only.\n${selected.join('\n')}`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    updatedToolOutput: {
      stdout: filtered,
      stderr: '',
      interrupted: Boolean(response.interrupted),
      isImage: Boolean(response.isImage),
    },
  },
}));
