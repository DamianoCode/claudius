// Unit tests for hooks/lib/transcript.mjs.
//
// This is where "the guard does not read the whole transcript" is actually proved.
// A stopwatch cannot prove it: a full scan of 15MB costs about 13ms, far inside the
// noise of spawning a process. Counting how many chunks the scanner pulls can.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

import { anyLine, scanFile, readTail, YES, NO, UNKNOWN } from '../hooks/lib/transcript.mjs';
import { withTmpDir } from './helpers.mjs';

const PREFIX = 'claudius-lib-';

// A chunk source that records how much of itself was consumed.
function countingChunks(chunks) {
  const state = { pulled: 0 };
  const source = (function* iterate() {
    for (const chunk of chunks) {
      state.pulled += 1;
      yield Buffer.from(chunk, 'utf8');
    }
  })();
  return { source, state };
}

// --- early exit ---

test('stops pulling chunks as soon as a line matches', () => {
  const { source, state } = countingChunks(['hit\n', 'a\n', 'b\n', 'c\n', 'd\n']);

  assert.equal(anyLine(source, (line) => line === 'hit'), true);
  assert.equal(state.pulled, 1, 'a match in the first chunk must not pull the rest');
});

test('pulls every chunk only when nothing matches', () => {
  const { source, state } = countingChunks(['a\n', 'b\n', 'c\n', 'd\n', 'e\n']);

  assert.equal(anyLine(source, (line) => line === 'hit'), false);
  assert.equal(state.pulled, 5);
});

test('matches a line that a chunk boundary splits in two', () => {
  const { source } = countingChunks(['pre', 'fix-hit\n']);

  assert.equal(anyLine(source, (line) => line === 'prefix-hit'), true);
});

test('matches the final line even when the source does not end with a newline', () => {
  const { source } = countingChunks(['a\n', 'trailing-hit']);

  assert.equal(anyLine(source, (line) => line === 'trailing-hit'), true);
});

test('reassembles a multi-byte character split across a chunk boundary', () => {
  const bytes = Buffer.from('zażółć\n', 'utf8');
  const cut = 3; // lands inside the two-byte 'ż'

  const chunks = (function* iterate() {
    yield bytes.subarray(0, cut);
    yield bytes.subarray(cut);
  })();

  assert.equal(anyLine(chunks, (line) => line === 'zażółć'), true);
});

// --- scanFile: three answers, not two ---

test('answers YES when the file contains a matching line', () => {
  withTmpDir(PREFIX, (dir) => {
    const path = join(dir, 'f.jsonl');
    writeFileSync(path, 'a\nhit\nb\n', 'utf8');
    assert.equal(scanFile(path, (line) => line === 'hit'), YES);
  });
});

test('answers NO when the file is readable and contains no matching line', () => {
  withTmpDir(PREFIX, (dir) => {
    const path = join(dir, 'f.jsonl');
    writeFileSync(path, 'a\nb\n', 'utf8');
    assert.equal(scanFile(path, (line) => line === 'hit'), NO);
  });
});

test('answers UNKNOWN rather than NO for a missing path', () => {
  assert.equal(scanFile('', () => true), UNKNOWN);
});

test('answers UNKNOWN rather than NO for a file that does not exist', () => {
  withTmpDir(PREFIX, (dir) => {
    assert.equal(scanFile(join(dir, 'nope.jsonl'), () => true), UNKNOWN);
  });
});

test('answers UNKNOWN rather than NO for a file past the size limit', () => {
  withTmpDir(PREFIX, (dir) => {
    // Proving a negative here would mean reading everything, so the honest answer is
    // "I did not check" — never "there is nothing there".
    const path = join(dir, 'big.jsonl');
    writeFileSync(path, 'a\nb\nc\n', 'utf8');
    assert.equal(scanFile(path, () => false, { limitBytes: 2 }), UNKNOWN);
  });
});

// --- readTail ---

test('reads only the tail and drops the partial line it starts on', () => {
  withTmpDir(PREFIX, (dir) => {
    const path = join(dir, 'f.jsonl');
    writeFileSync(path, 'first-line-is-long\nsecond\nthird\n', 'utf8');

    const tail = readTail(path, 14);
    assert.ok(!tail.includes('first-line-is-long'), 'the truncated first line must be dropped');
    assert.ok(tail.includes('third'));
  });
});

test('returns the whole file when the tail window is larger than it', () => {
  withTmpDir(PREFIX, (dir) => {
    const path = join(dir, 'f.jsonl');
    writeFileSync(path, 'only\n', 'utf8');
    assert.equal(readTail(path, 4096), 'only\n');
  });
});

test('returns an empty string rather than throwing for an unreadable path', () => {
  assert.equal(readTail('', 4096), '');
  withTmpDir(PREFIX, (dir) => {
    assert.equal(readTail(join(dir, 'nope'), 4096), '');
  });
});
