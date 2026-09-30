// Behavior tests for hooks/guard-subagent-stop.mjs (SubagentStop).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  runHook,
  runHookRaw,
  stopContinuation,
  withTmpDir,
  writeTranscript,
  editToolLine,
  shellToolLine,
  assistantTextLine,
  buildLargeTranscript,
} from './helpers.mjs';

const HOOK = 'guard-subagent-stop.mjs';
const PREFIX = 'claudius-guard-';


// --- input hygiene: every failure-shaped input must exit 0 without throwing ---

test('exits 0 and prints nothing for malformed JSON on stdin', () => {
  const result = runHookRaw(HOOK, '{not valid json');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('exits 0 and prints nothing for empty stdin', () => {
  const result = runHookRaw(HOOK, '');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('lets the agent stop for a well-formed event whose hook_event_name it does not own', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'PreToolUse',
    agent_type: 'test-runner',
    last_assistant_message: 'no RESULT here',
  });
  assert.equal(stopContinuation(result), '');
});

// --- stop_hook_active: never turn validation into a loop ---

test('lets the agent stop when stop_hook_active is true regardless of the rest of the payload', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    stop_hook_active: true,
    agent_type: 'test-runner',
    last_assistant_message: 'nothing useful',
  });
  assert.equal(stopContinuation(result), '');
});

// --- the continuation protocol ---

test('asks for a continuation through additionalContext, not through an exit-2 error', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'test-runner',
    last_assistant_message: 'Ran the tests, looked fine.',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(Object.keys(JSON.parse(result.stdout).hookSpecificOutput).sort(), [
    'additionalContext',
    'hookEventName',
  ]);
});

// --- test-runner contract ---

test('sends back a test-runner whose final message lacks RESULT:', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'test-runner',
    last_assistant_message: 'Ran the tests, looked fine.',
  });
  assert.match(stopContinuation(result), /RESULT/);
});

test('lets a test-runner whose final message has RESULT: stop', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'test-runner',
    last_assistant_message: 'RESULT: PASS\nCHECKS: npm test\nFAILURES: none\nEVIDENCE: ok\nNEXT: none',
  });
  assert.equal(stopContinuation(result), '');
});

// --- code-reviewer contract ---

test('sends back a code-reviewer whose final message lacks REVIEW:', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'code-reviewer',
    last_assistant_message: 'Looks good to me.',
  });
  assert.match(stopContinuation(result), /REVIEW/);
});

test('lets a code-reviewer whose final message has REVIEW: stop', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'code-reviewer',
    last_assistant_message: 'REVIEW: OK\nnothing else to add',
  });
  assert.equal(stopContinuation(result), '');
});

// --- clean-code-engineer contract ---

test('lets a clean-code-engineer that reports NO_CHANGE: with no edits at all stop', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'clean-code-engineer',
    last_assistant_message: 'NO_CHANGE: requested state already exists.',
  });
  assert.equal(stopContinuation(result), '');
});

test('lets a clean-code-engineer that reports BLOCKED: with no edits at all stop', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'clean-code-engineer',
    last_assistant_message: 'BLOCKED: missing prerequisite, cannot proceed.',
  });
  assert.equal(stopContinuation(result), '');
});

test('sends back a clean-code-engineer whose transcript records no edit tool', () => {
  withTmpDir(PREFIX, (dir) => {
    const transcript = writeTranscript(dir, [assistantTextLine('I looked around but changed nothing.')]);
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message: 'I looked around but changed nothing.',
    });
    assert.match(stopContinuation(result), /no Edit\/Write was recorded/);
  });
});

test('lets a clean-code-engineer that edited and returned the full completion report stop', () => {
  withTmpDir(PREFIX, (dir) => {
    const transcript = writeTranscript(dir, [
      editToolLine(),
      assistantTextLine('SCOPE: src/x.js\nASSUMPTIONS: none\n\nCHANGED:\n- src/x.js — fixed bug\n\nTESTS: none\nPUBLIC CONTRACT: none\nHANDOFF: none\nVERIFY:\nRISKS / FOLLOW-UPS: none'),
    ]);
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message:
        'SCOPE: src/x.js\nASSUMPTIONS: none\n\nCHANGED:\n- src/x.js — fixed bug\n\nTESTS: none\nPUBLIC CONTRACT: none\nHANDOFF: none\nVERIFY:\nRISKS / FOLLOW-UPS: none',
    });
    assert.equal(stopContinuation(result), '');
  });
});

test('sends back a clean-code-engineer that edited but did not return the completion report', () => {
  withTmpDir(PREFIX, (dir) => {
    const transcript = writeTranscript(dir, [editToolLine()]);
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message: 'Done, fixed it.',
    });
    assert.match(stopContinuation(result), /completion report/);
  });
});

// --- files changed through the shell ---

const FULL_REPORT =
  'SCOPE: src/\nASSUMPTIONS: none\n\nCHANGED:\n- src/y.js — renamed from src/x.js\n\nTESTS: none\nPUBLIC CONTRACT: none\nHANDOFF: none\nVERIFY:\nRISKS / FOLLOW-UPS: none';

function engineerStop(dir, commands, finalMessage, shell = 'Bash') {
  const transcript = writeTranscript(dir, [
    ...commands.map((command) => shellToolLine(command, shell)),
    assistantTextLine(finalMessage),
  ]);
  return runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'claudius:clean-code-engineer',
    agent_transcript_path: transcript,
    last_assistant_message: finalMessage,
  });
}

test('lets an engineer that changed files only through the shell and reported them stop', () => {
  withTmpDir(PREFIX, (dir) => {
    // A rename, a codemod or a generator leaves no Edit/Write behind. Such a worker used
    // to be told that nothing was recorded and to implement the task again.
    const result = engineerStop(dir, ['git mv src/x.js src/y.js'], FULL_REPORT);
    assert.equal(stopContinuation(result), '');
  });
});

test('asks an engineer that wrote files through the shell and ended on BLOCKED for a report', () => {
  withTmpDir(PREFIX, (dir) => {
    const result = engineerStop(dir, ["sed -i 's/a/b/' src/x.js"], 'BLOCKED: the API contract is missing.');
    assert.match(stopContinuation(result), /completion report/);
    assert.match(stopContinuation(result), /shell command/);
  });
});

test('does not tell a worker whose shell command may have changed nothing to skip the implementation', () => {
  withTmpDir(PREFIX, (dir) => {
    // The guard cannot see whether `rm` hit the repository or a temp directory, so the
    // request has to leave both endings open instead of asserting that files changed.
    const result = engineerStop(dir, ['rm -rf /tmp/scratch'], 'I cleaned up and looked around.');
    assert.match(stopContinuation(result), /NO_CHANGE/);
    assert.match(stopContinuation(result), /implement the assigned behavior/);
  });
});

for (const command of [
  'cat > src/x.js <<EOF\nexport const a = 1;\nEOF',
  'echo done >> notes.txt',
  'npm test && mv a.js b.js',
  'npx prettier --write src',
  'npx eslint --fix src',
  "perl -pi -e 's/a/b/' src/x.js",
  'git checkout -- src/x.js',
  'git stash pop',
  'npm run build | tee build.log',
]) {
  test(`reads \`${command.split('\n')[0]}\` as a command that writes files`, () => {
    withTmpDir(PREFIX, (dir) => {
      const result = engineerStop(dir, [command], 'NO_CHANGE: nothing to do.');
      assert.match(stopContinuation(result), /shell command/);
    });
  });
}

for (const command of ['Set-Content -Path src/x.js -Value $text', 'npm test | Out-File result.txt', 'remove-item src/x.js']) {
  test(`reads PowerShell \`${command}\` as a command that writes files`, () => {
    withTmpDir(PREFIX, (dir) => {
      const result = engineerStop(dir, [command], 'NO_CHANGE: nothing to do.', 'PowerShell');
      assert.match(stopContinuation(result), /shell command/);
    });
  });
}

for (const command of [
  'npm test 2>&1',
  'npm run lint > /dev/null',
  'npm test 2>$null',
  'git status --porcelain && git --no-pager diff --stat',
  'git log --format="%an <%ae>" -3',
  'grep -rn "a > b" src',
  'node -e "[1].map((x) => x > 0)"',
  'git stash list',
  'git checkout main',
  'ls -la src | head -20',
  'rg --files-with-matches sed-i',
]) {
  test(`does not read \`${command}\` as a command that writes files`, () => {
    withTmpDir(PREFIX, (dir) => {
      // Read-only shell use is what almost every engineer run looks like. It must leave
      // both of the existing outcomes exactly as they were.
      const stated = engineerStop(dir, [command], 'NO_CHANGE: requested state already exists.');
      assert.equal(stopContinuation(stated), '');

      const silent = engineerStop(dir, [command], 'I looked around but changed nothing.');
      assert.match(stopContinuation(silent), /no Edit\/Write was recorded/);
    });
  });
}

test('an edit tool anywhere in the transcript outranks a shell write seen before it', () => {
  withTmpDir(PREFIX, (dir) => {
    const transcript = writeTranscript(dir, [shellToolLine('rm -rf dist'), editToolLine()]);
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'claudius:clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message: 'Done, fixed it.',
    });
    assert.match(stopContinuation(result), /changed files but did not provide/);
  });
});

// --- agent identity resolution ---

test('resolves a namespaced agent identity the same way as the bare name', () => {
  const namespaced = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'claudius:test-runner',
    last_assistant_message: 'no result marker',
  });
  const bare = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'test-runner',
    last_assistant_message: 'no result marker',
  });
  assert.match(stopContinuation(namespaced), /RESULT/);
  assert.match(stopContinuation(bare), /RESULT/);
});

test('polices nobody when the event carries no agent identity, rather than guessing from the transcript', () => {
  withTmpDir(PREFIX, (dir) => {
    // A transcript names other agents all the time — a reviewer's own prompt talks about
    // the clean-code-engineer whose diff it is reading. Guessing identity from that text
    // would hand a read-only reviewer an instruction to go and implement something, so an
    // unidentified agent is left alone instead.
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'Review the diff produced by the clean-code-engineer.' },
      assistantTextLine('REVIEW: OK'),
    ]);
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_transcript_path: transcript,
      last_assistant_message: 'REVIEW: OK',
    });
    assert.equal(stopContinuation(result), '');
  });
});

// --- final message resolution ---

test('resolves the final assistant message from the transcript tail when last_assistant_message is absent', () => {
  withTmpDir(PREFIX, (dir) => {
    const transcript = writeTranscript(dir, [
      assistantTextLine('intermediate thought'),
      assistantTextLine('RESULT: PASS\nCHECKS: everything\nFAILURES: none\nEVIDENCE: ok\nNEXT: none'),
    ]);
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'test-runner',
      agent_transcript_path: transcript,
    });
    assert.equal(stopContinuation(result), '');
  });
});

// --- "could not check" is not "checked and found nothing" ---

test('stays permissive when the transcript is past the scan limit and shows no edit at all', () => {
  withTmpDir(PREFIX, (dir) => {
    // Over the limit the guard stops trying to prove a negative. The file deliberately
    // contains NO tool use, so a scanner that ignored the limit would answer "no edit"
    // and block — which is exactly the behaviour this test pins down.
    const transcript = buildLargeTranscript(join(dir, 'huge.jsonl'), 17 * 1024 * 1024, { withEdit: false });

    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'claudius:clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message: 'SCOPE: hooks/\nCHANGED:\n- hooks/x.mjs — rewritten',
    });

    assert.equal(stopContinuation(result), '', 'expected permissive');
  });
});

test('stays permissive when the event carries no transcript path', () => {
  const result = runHook(HOOK, {
    hook_event_name: 'SubagentStop',
    agent_type: 'claudius:clean-code-engineer',
    last_assistant_message: 'SCOPE: hooks/\nCHANGED:\n- hooks/x.mjs — rewritten',
  });

  assert.equal(stopContinuation(result), '', 'expected permissive');
});

test('stays permissive when the transcript file cannot be read', () => {
  withTmpDir(PREFIX, (dir) => {
    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'claudius:clean-code-engineer',
      agent_transcript_path: join(dir, 'does-not-exist.jsonl'),
      last_assistant_message: 'SCOPE: hooks/\nCHANGED:\n- hooks/x.mjs — rewritten',
    });

    assert.equal(stopContinuation(result), '', 'expected permissive');
  });
});

test('still demands a report from an engineer that edited files and then reported BLOCKED', () => {
  withTmpDir(PREFIX, (dir) => {
    // A worker that changed files and gave up partway is precisely when the orchestrator
    // must learn what was touched. BLOCKED excuses the absence of edits, never the
    // absence of a report about edits that happened.
    const transcript = writeTranscript(dir, [editToolLine(), assistantTextLine('gave up')]);

    const result = runHook(HOOK, {
      hook_event_name: 'SubagentStop',
      agent_type: 'claudius:clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message: 'BLOCKED: the API contract is missing.',
    });

    assert.match(stopContinuation(result), /completion report/);
  });
});
