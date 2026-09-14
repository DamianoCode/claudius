#!/usr/bin/env node
// SubagentStop hook: refuses a worker that stopped without doing its job, and asks it
// to continue once in the same context. Never loops — a stop hook gets one request.
//
// The event carries the agent identity (namespaced for a plugin agent, e.g.
// "claudius:clean-code-engineer"), the final message and the agent's own transcript
// path. Identity is never guessed from the transcript: a reviewer's prompt mentions
// other agents by name, and mistaking one for another would tell a read-only reviewer
// to go and implement something.
//
// Every uncertainty resolves in the worker's favour. Blocking a worker that finished
// is a worse failure than missing one that did not.

import { readTail, scanFile, YES, NO } from './lib/transcript.mjs';

const EXIT_OK = 0;

const TAIL_BYTES = 256 * 1024;
const SCAN_CHUNK_BYTES = 64 * 1024;
const SCAN_LIMIT_BYTES = 16 * 1024 * 1024;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

const IDENTITY_KEYS = ['agent_type', 'subagent_type', 'agentType', 'agent_name', 'subagent'];

const CONTRACTS = {
  'clean-code-engineer': checkEngineer,
  'test-runner': checkTestRunner,
  'code-reviewer': checkReviewer,
};

main();

async function main() {
  const input = await readInput();
  if (!input) process.exit(EXIT_OK);
  if (input.hook_event_name !== 'SubagentStop') process.exit(EXIT_OK);

  // A stop hook may request one continuation. Never turn validation into a loop.
  if (input.stop_hook_active === true) process.exit(EXIT_OK);

  const contract = CONTRACTS[resolveAgent(input)];
  if (!contract) process.exit(EXIT_OK); // unknown agent — not ours to police

  // Only the agent's own transcript. The event also carries `transcript_path`, which is
  // the main session's — scanning that would credit a worker with someone else's edits.
  const transcript = typeof input.agent_transcript_path === 'string' ? input.agent_transcript_path : '';

  const reason = contract(resolveFinalText(input, transcript), transcript);
  if (reason) block(reason);

  process.exit(EXIT_OK);
}

async function readInput() {
  // Collect buffers and decode once: appending each chunk as a string would mangle a
  // multi-byte character that happens to straddle a chunk boundary.
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Keeps the worker running with `reason` as its next instruction. additionalContext
// (Claude Code 2.1.163+) does that without the turn being labelled a hook error, which
// is how an exit-2 block reaches the user.
function block(reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStop', additionalContext: reason } }),
  );
  process.exit(EXIT_OK);
}

function resolveAgent(input) {
  const named = IDENTITY_KEYS.map((key) => input[key]).find(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
  return named ? bareName(named) : '';
}

// "claudius:clean-code-engineer" and "clean-code-engineer" are the same agent.
function bareName(value) {
  const trimmed = value.trim();
  const colon = trimmed.lastIndexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(colon + 1);
}

function resolveFinalText(input, transcript) {
  const fromEvent = input.last_assistant_message;
  if (typeof fromEvent === 'string' && fromEvent.trim() !== '') return fromEvent;
  return lastAssistantText(transcript);
}

function lastAssistantText(path) {
  const lines = readTail(path, TAIL_BYTES)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = assistantText(parseLine(lines[i]));
    if (text) return text;
  }
  return '';
}

function assistantText(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const message = entry.message ?? entry;
  if (message?.role && message.role !== 'assistant') return '';

  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

// YES / NO / UNKNOWN — an unreadable, missing or oversized transcript is UNKNOWN, and
// UNKNOWN must never be read as "this worker edited nothing".
function editedFiles(path) {
  return scanFile(path, lineHasEditTool, {
    chunkBytes: SCAN_CHUNK_BYTES,
    limitBytes: SCAN_LIMIT_BYTES,
  });
}

function lineHasEditTool(line) {
  // Cheap substring gate before the expensive parse — this is what keeps a long
  // transcript affordable, since almost no line mentions a tool use at all.
  if (!line.includes('"tool_use"')) return false;
  return findEditTool(parseLine(line));
}

function findEditTool(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'tool_use' && EDIT_TOOLS.has(bareName(String(value.name ?? '')))) return true;
  if (Array.isArray(value)) return value.some(findEditTool);
  return Object.values(value).some(findEditTool);
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null; // partial or malformed JSONL line
  }
}

function has(text, pattern) {
  return pattern.test(text);
}

// --- per-agent contracts --------------------------------------------------

function checkEngineer(finalText, transcript) {
  const edited = editedFiles(transcript);
  const statedNonEdit = has(finalText, /(?:^|\n)\s*(?:NO_CHANGE|BLOCKED)\s*:/i);
  const hasReport =
    has(finalText, /(?:^|\n)\s*SCOPE\s*:/i) && has(finalText, /(?:^|\n)\s*(?:CHANGED|RISKS \/ FOLLOW-UPS)\s*:/i);

  // Proven to have edited nothing. Only a stated reason makes that a legitimate ending.
  if (edited === NO && !statedNonEdit) {
    return 'Implementation is not complete: no Edit/Write was recorded. Continue in the same context. Reuse what you already learned and implement the assigned behavior now. If no change is required, finish with `NO_CHANGE: <evidence>`; if safe completion is impossible inside the scope/contract, finish with `BLOCKED: <specific prerequisite>`.';
  }
  if (edited === NO) return '';

  // Files changed (YES), or we could not tell (UNKNOWN). Either way the orchestrator
  // needs to know what was touched, so the report is required — including when the
  // worker gave up partway through and ended on BLOCKED. Where the transcript could not
  // be read at all, an explicit non-edit exit stands in for it rather than blocking.
  if (hasReport || (edited !== YES && statedNonEdit)) return '';

  return 'Implementation changed files but did not provide the required completion report. Do not redo the implementation. Inspect your existing work/verification and return the compact SCOPE / ASSUMPTIONS / CHANGED / TESTS / PUBLIC CONTRACT / HANDOFF / VERIFY / RISKS report.';
}

function checkTestRunner(finalText) {
  if (has(finalText, /(?:^|\n)\s*RESULT\s*:\s*(?:PASS|FAIL|BLOCKED)\b/i)) return '';
  return 'Verification is incomplete. Continue in the same context, finish the supplied/relevant checks, then return `RESULT: PASS|FAIL|BLOCKED` with CHECKS / FAILURES / EVIDENCE / NEXT. Do not add unrelated checks.';
}

function checkReviewer(finalText) {
  if (has(finalText, /(?:^|\n)\s*REVIEW\s*:\s*(?:OK|FINDINGS|NO SPEC)\b/i)) return '';
  return 'Review is incomplete. Continue in the same context and return the required `REVIEW: OK|FINDINGS|NO SPEC` report. Do not broaden scope or perform implementation.';
}
