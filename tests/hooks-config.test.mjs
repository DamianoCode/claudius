// Consistency between hooks/hooks.json, the hook files it points at, and the report
// contracts written in agents/*.md.
//
// These are the failures no behavioural test would catch: a typo in a hook path, an
// agent renamed out of the SubagentStop matcher, or a report template edited so that it
// no longer contains the keys the guard insists on. Each of those breaks the plugin
// silently — the hook simply stops running, or starts blocking every worker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  REPO_ROOT,
  runHook,
  stopContinuation,
  makeTmpDir,
  removeDir,
  writeTranscript,
  editToolLine,
} from './helpers.mjs';

const config = JSON.parse(readFileSync(join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));

// The agents whose completion the guard enforces, and the key each report must carry.
const GUARDED = {
  'clean-code-engineer': /(?:^|\n)\s*SCOPE\s*:/i,
  'test-runner': /(?:^|\n)\s*RESULT\s*:\s*(?:PASS|FAIL|BLOCKED)\b/i,
  'code-reviewer': /(?:^|\n)\s*REVIEW\s*:\s*(?:OK|FINDINGS|NO SPEC)\b/i,
  skeptic: /(?:^|\n)\s*VERDICT\s*:\s*(?:PROCEED|CHANGE|STOP)\b/i,
};

function everyHookCommand() {
  return Object.values(config.hooks)
    .flat()
    .flatMap((entry) => entry.hooks)
    .map((hook) => hook.command);
}

// --- hooks.json points at things that exist ---

test('every hook command references a file that is actually in the repository', () => {
  const commands = everyHookCommand();
  assert.ok(commands.length > 0, 'hooks.json declares no commands at all');

  for (const command of commands) {
    const match = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/);
    assert.ok(match, `hook command does not resolve from the plugin root: ${command}`);
    const relative = match[1];
    assert.ok(
      existsSync(join(REPO_ROOT, relative)),
      `hooks.json points at ${relative}, which does not exist`,
    );
  }
});

test('every hook declares a timeout, so a stuck hook cannot hang a session', () => {
  const hooks = Object.values(config.hooks)
    .flat()
    .flatMap((entry) => entry.hooks);

  for (const hook of hooks) {
    assert.equal(typeof hook.timeout, 'number', `a hook has no timeout: ${hook.command}`);
  }
});

// --- the plugin manifest must not re-declare what is loaded automatically ---

test('the manifest does not point at the standard hooks file', () => {
  // Claude Code loads hooks/hooks.json by itself. Naming it in the manifest as well
  // registers the same file twice, and the whole plugin's hooks then fail to load:
  // "Duplicate hooks file detected". manifest.hooks is only for additional files.
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const declared = [manifest.hooks ?? []].flat();

  for (const entry of declared) {
    assert.notEqual(
      entry.replace(/^\.\//, ''),
      'hooks/hooks.json',
      'hooks/hooks.json is loaded automatically; naming it here breaks hook loading entirely',
    );
  }
});

test('every agent the manifest lists exists on disk', () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

  for (const entry of manifest.agents ?? []) {
    assert.ok(
      existsSync(join(REPO_ROOT, entry.replace(/^\.\//, ''))),
      `the manifest lists ${entry}, which does not exist`,
    );
  }
});

// --- the SubagentStop matcher and the guarded agents agree ---

// A plugin agent reports a scoped agent_type such as "claudius:test-runner". Since Claude
// Code 2.1.195 a matcher made only of letters, digits, "_", "-", spaces, "," and "|" is a
// list of exact names, and a list of bare names never matches a scoped one — the guard
// then silently never runs. Any other character makes it an unanchored JavaScript regex.
const EXACT_MATCH_ONLY = /^[A-Za-z0-9_\- ,|]*$/;
const SCOPED_MATCHER = /^\^claudius:\(([^()]+)\)\$$/;

function subagentStopMatcher() {
  return config.hooks.SubagentStop[0].matcher;
}

test('the SubagentStop matcher lists exactly the agents whose completion is enforced', () => {
  const matcher = subagentStopMatcher();
  const scoped = matcher.match(SCOPED_MATCHER);
  assert.ok(scoped, `expected the form ^claudius:(a|b|c)$, got ${matcher}`);
  const listed = scoped[1].split('|').map((name) => name.trim());

  assert.deepEqual(listed.slice().sort(), Object.keys(GUARDED).sort());

  for (const name of listed) {
    assert.ok(
      existsSync(join(REPO_ROOT, 'agents', `${name}.md`)),
      `the matcher names ${name}, but agents/${name}.md does not exist`,
    );
  }
});

test('the SubagentStop matcher fires for exactly the plugin-scoped names Claude Code reports', () => {
  const source = subagentStopMatcher();
  assert.doesNotMatch(source, EXACT_MATCH_ONLY, 'Claude Code would compare this matcher as exact names');

  // Evaluated the way Claude Code evaluates it: RegExp.prototype.test, unanchored.
  const matcher = new RegExp(source);
  for (const name of Object.keys(GUARDED)) {
    assert.ok(matcher.test(`claudius:${name}`), `does not fire for claudius:${name}`);
    assert.ok(!matcher.test(`claudius:senior-${name}`), `also fires for claudius:senior-${name}`);
    assert.ok(!matcher.test(`other-plugin:${name}`), `also fires for other-plugin:${name}`);
  }
  assert.ok(!matcher.test('claudius:Explore'), 'fires for the unguarded explorer');
});

test('every agent definition in the repository is either guarded or deliberately not', () => {
  // A new agent should be a conscious decision about whether its completion is policed,
  // not something that silently falls outside the matcher.
  const agents = readdirSync(join(REPO_ROOT, 'agents'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''));

  const unguarded = agents.filter((name) => !(name in GUARDED));
  assert.deepEqual(unguarded, ['Explore'], 'only the read-only explorer is expected to be unguarded');
});

// --- the report templates in agents/*.md satisfy the guard ---

function reportTemplate(agent) {
  const source = readFileSync(join(REPO_ROOT, 'agents', `${agent}.md`), 'utf8');
  const blocks = [...source.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.ok(blocks.length > 0, `agents/${agent}.md has no fenced report template`);
  return blocks[blocks.length - 1];
}

for (const [agent, key] of Object.entries(GUARDED)) {
  test(`the report template in agents/${agent}.md still carries the key the guard looks for`, () => {
    assert.match(reportTemplate(agent), key);
  });
}

test('a report copied verbatim from the clean-code-engineer template passes the guard', () => {
  // Binds the documentation to the hook: translating or renaming a key in the agent file
  // would make every finished worker look unfinished, and this is what notices.
  const dir = makeTmpDir('claudius-config-');
  try {
    const transcript = writeTranscript(dir, [editToolLine()]);
    const result = runHook('guard-subagent-stop.mjs', {
      hook_event_name: 'SubagentStop',
      agent_type: 'claudius:clean-code-engineer',
      agent_transcript_path: transcript,
      last_assistant_message: reportTemplate('clean-code-engineer'),
    });
    assert.equal(stopContinuation(result), '', 'guard rejected its own agent\'s template');
  } finally {
    removeDir(dir);
  }
});

for (const agent of ['test-runner', 'code-reviewer', 'skeptic']) {
  test(`a report copied verbatim from the ${agent} template passes the guard`, () => {
    const result = runHook('guard-subagent-stop.mjs', {
      hook_event_name: 'SubagentStop',
      agent_type: `claudius:${agent}`,
      last_assistant_message: reportTemplate(agent),
    });
    assert.equal(stopContinuation(result), '', 'guard rejected its own agent\'s template');
  });
}
