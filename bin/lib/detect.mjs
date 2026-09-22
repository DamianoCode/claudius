// Proposes a workspace.json for a repository from what is actually in it. Read-only:
// the caller decides whether to write. Every value comes with the reason it was chosen,
// so `init` can show its working instead of presenting guesses as facts.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const run = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
};
const isIgnored = (main, rel) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: main }).status === 0;
const exists = (main, rel) => existsSync(join(main, rel));

// Install steps, first match wins. Each runs only when its lockfile changes.
const INSTALLERS = [
  { lock: 'pnpm-lock.yaml', run: 'pnpm install --frozen-lockfile', keep: ['node_modules'] },
  { lock: 'bun.lock', run: 'bun install --frozen-lockfile', keep: ['node_modules'] },
  { lock: 'bun.lockb', run: 'bun install --frozen-lockfile', keep: ['node_modules'] },
  { lock: 'yarn.lock', run: (main) => (exists(main, '.yarnrc.yml') ? 'yarn install --immutable' : 'yarn install --frozen-lockfile'), keep: ['node_modules'] },
  { lock: 'package-lock.json', run: 'npm install --no-audit --no-fund', keep: ['node_modules'] },
  { lock: 'uv.lock', run: 'uv sync', keep: ['.venv'] },
  { lock: 'poetry.lock', run: 'poetry install', keep: ['.venv'] },
  { lock: 'Pipfile.lock', run: 'pipenv sync', keep: ['.venv'] },
  { lock: 'Gemfile.lock', run: 'bundle install', keep: ['vendor/bundle'] },
  { lock: 'composer.lock', run: 'composer install', keep: ['vendor'] },
  { lock: 'go.sum', run: 'go mod download', keep: [] },
];

// Ignored directories worth keeping between tasks when present: caches and build state
// that are slow to rebuild and never carry one task's work into the next.
const CACHE_DIRS = ['.nx', '.turbo', '.gradle', 'target', '.venv', 'generated'];

const commitTime = (main, ref) => Number(run(main, 'log', '-1', '--format=%ct', ref)) || 0;

// Where new work starts: the remote default branch — unless release branches carry newer
// commits than it, which is how a weekly-release flow looks from the outside.
function detectBase(main) {
  let fallback = run(main, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  let why = 'the remote default branch';
  if (!fallback || fallback === 'origin/HEAD') {
    fallback = ['origin/main', 'origin/master', 'origin/develop']
      .find((ref) => run(main, 'rev-parse', '--verify', '--quiet', ref)) ?? '';
    why = 'the conventional default branch (origin/HEAD is not recorded)';
  }
  const newestRelease = run(main, 'for-each-ref', '--sort=-committerdate', '--count=1', '--format=%(refname:short)', 'refs/remotes/origin/release/*');
  if (newestRelease && (!fallback || commitTime(main, newestRelease) > commitTime(main, fallback))) {
    return { value: 'origin/release/*', why: `release branches carry newer work than ${fallback || 'any default branch'} (newest: ${newestRelease})` };
  }
  if (fallback) return { value: fallback, why };
  return { value: 'origin/HEAD', why: 'no remote default branch found — pass --base to be explicit' };
}

// Where this repository's worktrees already live, if they share one parent directory.
function detectPool(main) {
  const parents = new Map();
  for (const line of run(main, 'worktree', 'list', '--porcelain').split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const path = resolve(line.slice('worktree '.length));
    if (path === main) continue;
    const parent = dirname(path);
    parents.set(parent, (parents.get(parent) ?? 0) + 1);
  }
  const [busiest] = [...parents.entries()].sort((a, b) => b[1] - a[1]);
  if (busiest && busiest[1] >= 2) {
    return { value: relative(main, busiest[0]).split(sep).join('/'), why: `${busiest[1]} existing worktrees already live there` };
  }
  return { value: `../${basename(main)}-worktrees`, why: 'beside the repository, outside its working tree' };
}

// Top-level folders holding the code: the workspace globs of the package manager, or src/.
function detectProtect(main) {
  const globs = [];
  if (exists(main, 'pnpm-workspace.yaml')) {
    for (const match of readFileSync(join(main, 'pnpm-workspace.yaml'), 'utf8').matchAll(/^\s*-\s*['"]?([^'"\s#]+)/gm)) globs.push(match[1]);
  }
  if (exists(main, 'package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(main, 'package.json'), 'utf8'));
      const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
      globs.push(...ws);
    } catch {
      /* unreadable manifest — nothing to learn from it */
    }
  }
  const tops = [...new Set(globs.filter((g) => !g.startsWith('!')).map((g) => g.split('/')[0]).filter((top) => top && !top.includes('*')))]
    .filter((top) => exists(main, top));
  if (tops.length) return { value: tops.map((top) => `${top}/`), why: 'the workspace folders the package manager declares' };
  if (exists(main, 'src')) return { value: ['src/'], why: 'the source folder' };
  return { value: [], why: 'no obvious code folder — the edit guard stays off until you name one' };
}

function detectCopy(main) {
  const envs = readdirSync(main).filter((name) => /^\.env(\..+)?$/.test(name) && isIgnored(main, name));
  return { value: envs, why: envs.length ? 'untracked env files a checkout cannot recreate' : 'no untracked env files at the root' };
}

export function detectConfig(main) {
  const installer = INSTALLERS.find((i) => exists(main, i.lock));
  const keep = new Set(installer?.keep ?? []);
  // A cache counts when git ignores it or anything inside it (.nx is often ignored only
  // as .nx/cache); "generated" counts at any depth.
  const ignored = run(main, 'ls-files', '-o', '-i', '--exclude-standard', '--directory')
    .split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\/$/, '').split('/'));
  for (const dir of CACHE_DIRS) {
    const found = dir === 'generated'
      ? ignored.some((segments) => segments.at(-1) === 'generated')
      : ignored.some((segments) => segments[0] === dir);
    if (found) keep.add(dir);
  }
  const copy = detectCopy(main);
  if (copy.value.length) keep.add('.env*');

  const base = detectBase(main);
  const pool = detectPool(main);
  const protect = detectProtect(main);
  const prepare = installer
    ? [{ when: [installer.lock], run: typeof installer.run === 'function' ? installer.run(main) : installer.run }]
    : [];

  // Code generators vary too much per project to guess a command; point at them instead.
  const hints = [];
  const schemas = [...new Set(run(main, 'ls-files', '*.prisma').split(/\r?\n/).filter(Boolean).map((f) => dirname(f).split(sep).join('/')))];
  if (schemas.length) {
    hints.push(`Prisma schemas in ${schemas.slice(0, 3).join(', ')}${schemas.length > 3 ? ', …' : ''} — if the install does not generate the client, add a prepare step with "when": ["<schema dir>/*.prisma"].`);
  }

  return {
    hints,
    config: { mode: 'worktrees', pool: pool.value, prefix: 'slot', size: 4, base: base.value, protect: protect.value, keep: [...keep], copy: copy.value, prepare },
    reasons: {
      base: base.why,
      pool: pool.why,
      protect: protect.why,
      keep: keep.size ? 'dependencies and caches that are slow to rebuild' : 'nothing slow to rebuild found',
      copy: copy.why,
      prepare: installer ? `${installer.lock} — reinstalls only when it changes` : 'no lockfile recognised — add your own steps',
    },
  };
}
