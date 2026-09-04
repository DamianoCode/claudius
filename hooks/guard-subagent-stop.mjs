#!/usr/bin/env node

import fs from 'node:fs';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

if (input?.hook_event_name !== 'SubagentStop') process.exit(0);

// A stop hook may request one continuation. Never turn completion validation into a loop.
if (input.stop_hook_active === true) process.exit(0);

const type = String(input.agent_type ?? '');
const finalText = String(input.last_assistant_message ?? '');

function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function transcriptHasTool(names) {
  const path = input.agent_transcript_path;
  if (!path) return false;

  let content;
  try {
    content = fs.readFileSync(path, 'utf8');
  } catch {
    return false;
  }

  const wanted = new Set(names);
  const walk = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (value.type === 'tool_use' && wanted.has(value.name)) return true;
    if (Array.isArray(value)) return value.some(walk);
    return Object.values(value).some(walk);
  };

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      if (walk(JSON.parse(line))) return true;
    } catch {
      // Ignore malformed/partial JSONL lines.
    }
  }
  return false;
}

if (type === 'clean-code-engineer') {
  const hasEdit = transcriptHasTool(['Edit', 'Write', 'NotebookEdit']);
  const explicitNoEditExit = /(?:^|\n)\s*(?:NO_CHANGE|BLOCKED)\s*:/i.test(finalText);
  const hasReport = /(?:^|\n)\s*SCOPE\s*:/i.test(finalText) && /(?:^|\n)\s*(?:CHANGED|RISKS \/ FOLLOW-UPS)\s*:/i.test(finalText);

  if (!hasEdit && !explicitNoEditExit) {
    block('Implementation is not complete: no Edit/Write was recorded. Continue in the same context. Reuse what you already learned and implement the assigned behavior now. If no change is required, finish with `NO_CHANGE: <evidence>`; if safe completion is impossible inside the scope/contract, finish with `BLOCKED: <specific prerequisite>`.');
  }
  if (hasEdit && !hasReport) {
    block('Implementation changed files but did not provide the required completion report. Do not redo the implementation. Inspect your existing work/verification and return the compact SCOPE / ASSUMPTIONS / CHANGED / TESTS / PUBLIC CONTRACT / HANDOFF / VERIFY / RISKS report.');
  }
}

if (type === 'test-runner') {
  const hasResult = /(?:^|\n)\s*RESULT\s*:\s*(?:PASS|FAIL|BLOCKED)\b/i.test(finalText);
  if (!hasResult) {
    block('Verification is incomplete. Continue in the same context, finish the supplied/relevant checks, then return `RESULT: PASS|FAIL|BLOCKED` with CHECKS / FAILURES / EVIDENCE / NEXT. Do not add unrelated checks.');
  }
}

if (type === 'code-reviewer') {
  const hasReview = /(?:^|\n)\s*REVIEW\s*:\s*(?:OK|FINDINGS|NO SPEC)\b/i.test(finalText);
  if (!hasReview) {
    block('Review is incomplete. Continue in the same context and return the required `REVIEW: OK|FINDINGS` report. Do not broaden scope or perform implementation.');
  }
}

process.exit(0);
