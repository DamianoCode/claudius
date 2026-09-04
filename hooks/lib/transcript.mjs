// Reading a JSONL transcript without paying for its whole length.
//
// The scanner is separated from the file so it can be driven by any chunk source.
// That is what makes "it stops at the first hit" provable: a test feeds it a counting
// source and asserts how many chunks were pulled. Timing cannot show this — a full
// scan of 15MB costs about 13ms, well inside the noise of starting a process.

import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export const DEFAULT_CHUNK_BYTES = 64 * 1024;

// Three outcomes, not two. "I could not check" is not the same claim as "it is not
// there", and a guard that confuses them punishes a worker for an unreadable file.
export const YES = 'yes';
export const NO = 'no';
export const UNKNOWN = 'unknown';

/**
 * Runs `predicate` over the lines of a chunk source, stopping at the first match.
 * Chunks are decoded incrementally so a multi-byte character split across a boundary
 * is reassembled rather than corrupted.
 */
export function anyLine(chunks, predicate) {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  for (const chunk of chunks) {
    const text = pending + decoder.write(chunk);
    const lines = text.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (predicate(line)) return true;
    }
  }

  return predicate(pending + decoder.end());
}

/**
 * Answers a yes/no question about a file's lines, or UNKNOWN when it cannot be answered:
 * the path is missing, the file is unreadable, or it is larger than `limitBytes` and
 * proving a negative would mean reading all of it.
 */
export function scanFile(path, predicate, { chunkBytes = DEFAULT_CHUNK_BYTES, limitBytes = Infinity } = {}) {
  if (!path) return UNKNOWN;

  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return UNKNOWN;
  }

  try {
    const size = fstatSync(fd).size;
    if (size > limitBytes) return UNKNOWN;
    return anyLine(readChunks(fd, size, chunkBytes), predicate) ? YES : NO;
  } catch {
    return UNKNOWN;
  } finally {
    closeSync(fd);
  }
}

/** Reads the last `bytes` of a file, dropping the partial line the slice starts on. */
export function readTail(path, bytes) {
  if (!path) return '';

  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return '';
  }

  try {
    const size = fstatSync(fd).size;
    const length = Math.min(bytes, size);
    const start = size - length;
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync(fd, buffer, 0, length, start);
    const text = buffer.toString('utf8', 0, read);
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return '';
  } finally {
    closeSync(fd);
  }
}

function* readChunks(fd, size, chunkBytes) {
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let position = 0;

  while (position < size) {
    const read = readSync(fd, buffer, 0, chunkBytes, position);
    if (read <= 0) return;
    position += read;
    // Copy: the caller may hold the chunk past the next read into the shared buffer.
    yield Buffer.from(buffer.subarray(0, read));
  }
}
