#!/usr/bin/env node
// SessionStart hook: sprawdza, czy prywatna nakładka ~/.claude/context/<repo>/PROJECT.md
// nie jest starsza niż pliki, z których powstała. Milczy, gdy wszystko jest świeże.
// Nic nie zapisuje i nigdy nie blokuje startu sesji.

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const quit = () => process.exit(0);

// Wejście hooka przychodzi jako JSON na stdin; cwd bierzemy z niego, gdy jest.
let cwd = process.cwd();
try {
  const parsed = JSON.parse(readFileSync(0, 'utf8'));
  if (parsed && typeof parsed.cwd === 'string') cwd = parsed.cwd;
} catch {
  /* brak wejścia albo nie-JSON — zostajemy przy process.cwd() */
}

const git = (args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

let root;
try {
  root = git(['rev-parse', '--show-toplevel']);
} catch {
  quit(); // nie repozytorium — nie nasza sprawa
}
if (!root) quit();

const repo = basename(root);
const dir = join(homedir(), '.claude', 'context', repo);
const overlay = join(dir, 'PROJECT.md');

if (!existsSync(overlay)) {
  console.log(
    `[kontekst] Brak nakładki dla "${repo}". Uruchom /project-profile, żeby skille nie musiały ustalać komend i szwów od zera przy każdym zadaniu.`,
  );
  quit();
}

const overlayMtime = statSync(overlay).mtimeMs;

// Pliki, z których nakładka czerpie fakty. Stała lista plus śledzone schematy —
// tanie, bo git ls-files jest indeksowane, a stat robimy na kilkudziesięciu ścieżkach.
const fixed = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'nx.json',
  'turbo.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
];

let tracked = [];
try {
  tracked = git(['ls-files', '*.prisma', '.claude/rules/*.md', '*.config.ts'])
    .split('\n')
    .filter(Boolean)
    .slice(0, 120); // twardy limit, żeby hook nigdy nie zrobił się drogi
} catch {
  /* brak dopasowań */
}

const newer = [];
for (const rel of [...fixed, ...tracked]) {
  const abs = join(root, rel);
  try {
    if (statSync(abs).mtimeMs > overlayMtime) newer.push(rel);
  } catch {
    /* pliku nie ma — pomijamy */
  }
}

if (newer.length === 0) quit();

const days = Math.round((Date.now() - overlayMtime) / 86_400_000);
const shown = newer.slice(0, 3).join(', ');
const rest = newer.length > 3 ? ` (+${newer.length - 3})` : '';

console.log(
  `[kontekst] Nakładka ~/.claude/context/${repo}/PROJECT.md ma ${days} dni i jest starsza niż: ${shown}${rest}. ` +
    `Jeśli zmienił się stack, komendy albo reguły — odśwież ją przez /project-profile. Sam plik może być nadal poprawny.`,
);
