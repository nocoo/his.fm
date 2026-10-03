import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const repo = join(here, '..');
const owned = mkdtempSync(join(tmpdir(), 'hisfm-gate-verify-'));
let failed = 0;

const model = `export function ready(value: string): boolean {
  return value.trim().length > 0;
}
`;
const passingTest = `import { expect, it } from 'vitest';
import { ready } from './model';

it('accepts text', () => {
  expect(ready('a')).toBe(true);
  expect(ready('  ')).toBe(false);
});
`;
const failingTest = passingTest.replace('toBe(true)', 'toBe(false)');

function check(name, ok, detail = '') {
  const text = detail.replace(/\s+/g, ' ').slice(0, 240);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${text ? `: ${text}` : ''}`);
  if (!ok) failed = 1;
}

function rootIndex() {
  return execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' });
}

function rootHooks() {
  return execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
}

const indexBefore = rootIndex();
const hooksBefore = rootHooks();

function fixture(name, extra = {}) {
  const dir = join(owned, name);
  mkdirSync(join(dir, 'src/admin'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.husky'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const file of ['tsconfig.json', 'vitest.config.ts']) {
    writeFileSync(join(dir, file), readFileSync(join(repo, 'apps/web', file)));
  }
  const biome = JSON.parse(readFileSync(join(repo, 'biome.json'), 'utf8'));
  biome.files.includes = ['src/**', 'scripts/**', '*.json', '*.ts'];
  writeFileSync(join(dir, 'biome.json'), `${JSON.stringify(biome, null, 2)}\n`);
  execFileSync(join(repo, 'node_modules/.bin/biome'), ['format', '--write', 'biome.json'], { cwd: dir });
  writeFileSync(join(dir, 'scripts/check-staged.mjs'), readFileSync(join(repo, 'scripts/check-staged.mjs')));
  writeFileSync(join(dir, '.husky/pre-commit'), readFileSync(join(repo, '.husky/pre-commit')));
  chmodSync(join(dir, '.husky/pre-commit'), 0o755);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        type: 'module',
        scripts: {
          'test:coverage': 'vitest run --coverage',
          lint: 'biome check . --error-on-warnings',
          typecheck: 'tsc --noEmit',
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, 'src/admin/model.ts'), model);
  if (!extra.skipTest) writeFileSync(join(dir, 'src/admin/model.test.ts'), extra.test ?? passingTest);
  if (extra.lint) writeFileSync(join(dir, 'src/admin/bad-lint.ts'), extra.lint);
  if (extra.css) writeFileSync(join(dir, 'src/warn.css'), extra.css);
  if (extra.typed) writeFileSync(join(dir, 'src/admin/bad-type.ts'), extra.typed);
  if (extra.gap) {
    mkdirSync(join(dir, 'src/shared'), { recursive: true });
    writeFileSync(join(dir, 'src/shared/gap.ts'), extra.gap);
  }
  writeFileSync(join(dir, '.gitignore'), 'node_modules\ncoverage\n.cloudflare\n');
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  execFileSync(
    'git',
    [
      'add',
      '--',
      '.gitignore',
      'package.json',
      'biome.json',
      'tsconfig.json',
      'vitest.config.ts',
      'scripts',
      'src',
      '.husky',
    ],
    { cwd: dir },
  );
  if (extra.worktreeTest) writeFileSync(join(dir, 'src/admin/model.test.ts'), extra.worktreeTest);
  return dir;
}

function scratchOf(dir) {
  const scratch = join(dir, '.tmp');
  mkdirSync(scratch, { recursive: true });
  return scratch;
}

function resultOf(scratch, result) {
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    leftovers: existsSync(scratch) ? readdirSync(scratch) : ['missing'],
  };
}

function snapshotGone(leftovers) {
  return leftovers.every((name) => !name.startsWith('hisfm-l1-'));
}

function runHook(dir, env = {}) {
  const scratch = scratchOf(dir);
  return resultOf(
    scratch,
    spawnSync('sh', ['.husky/pre-commit'], {
      cwd: dir,
      env: { ...process.env, TMPDIR: scratch, ...env },
      encoding: 'utf8',
      timeout: 180000,
    }),
  );
}

function installHusky(dir) {
  execFileSync('git', ['config', 'user.email', 'gate@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'gate'], { cwd: dir });
  const installed = spawnSync(process.execPath, [join(repo, 'node_modules/husky/bin.js')], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
  return execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
}

function commitHook(dir) {
  const scratch = scratchOf(dir);
  const headBefore = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  const committed = spawnSync('git', ['commit', '-m', 'probe'], {
    cwd: dir,
    env: { ...process.env, TMPDIR: scratch },
    encoding: 'utf8',
    timeout: 180000,
  });
  const headAfter = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return { ...resultOf(scratch, committed), headBefore: headBefore.status, headAfter: headAfter.status };
}

try {
  const healthyDir = fixture('healthy');
  const healthy = runHook(healthyDir);
  check('healthy real gate exits 0', healthy.status === 0, healthy.output);
  check('healthy snapshot removed', snapshotGone(healthy.leftovers), healthy.leftovers.join(','));

  const utDir = fixture('ut', { test: failingTest, worktreeTest: passingTest });
  const ut = runHook(utDir);
  check('staged UT failure rejects', ut.status !== 0 && ut.output.includes('FAIL'), ut.output);
  check(
    'UT probe keeps unstaged fix',
    readFileSync(join(utDir, 'src/admin/model.test.ts'), 'utf8') === passingTest,
  );
  check(
    'UT probe keeps failing index',
    execFileSync('git', ['show', ':src/admin/model.test.ts'], { cwd: utDir, encoding: 'utf8' }).includes(
      'toBe(false)',
    ),
  );

  const gap = `export function uncovered(): number {
  return 0;
}
`;
  const coverageDir = fixture('coverage', { gap });
  const coverage = runHook(coverageDir);
  check(
    'coverage shortfall rejects',
    coverage.status !== 0 && /threshold/i.test(coverage.output),
    coverage.output,
  );

  const lintDir = fixture('lint', {
    lint: `export function stop(): void {
  debugger;
}
`,
  });
  const lint = runHook(lintDir);
  check('biome lint error rejects', lint.status !== 0 && lint.output.includes('noDebugger'), lint.output);

  const typeDir = fixture('type', {
    typed: `export const value: number = 'bad';
`,
  });
  const type = runHook(typeDir);
  check('tsc error rejects', type.status !== 0 && type.output.includes('TS2322'), type.output);
  check('type probe preserves worktree', readFileSync(join(typeDir, 'src/admin/model.ts'), 'utf8') === model);

  const warningDir = fixture('warning', {
    css: `.badge {
  color: red !important;
}
`,
  });
  const warningHooks = installHusky(warningDir);
  const warning = commitHook(warningDir);
  check('fixture husky hooksPath', warningHooks === '.husky/_', warningHooks);
  check(
    'husky commit rejects biome warning',
    warning.status !== 0 &&
      warning.output.includes('noImportantStyles') &&
      warning.output.includes('husky -'),
    warning.output,
  );
  check(
    'failed commit leaves HEAD',
    warning.headBefore !== 0 && warning.headAfter !== 0,
    String(warning.headAfter),
  );
  check('warning snapshot removed', snapshotGone(warning.leftovers), warning.leftovers.join(','));

  const emptyDir = fixture('empty', { skipTest: true });
  const empty = runHook(emptyDir);
  check('empty suite rejects', empty.status !== 0 && /no test files/i.test(empty.output), empty.output);
  check('empty snapshot removed', snapshotGone(empty.leftovers), empty.leftovers.join(','));

  const timeoutDir = fixture('timeout');
  writeFileSync(
    join(timeoutDir, 'package.json'),
    `${JSON.stringify({ scripts: { 'test:coverage': 'node -e "setInterval(() => {}, 1000)"', lint: 'node -e 0', typecheck: 'node -e 0' } }, null, 2)}\n`,
  );
  execFileSync('git', ['add', '--', 'package.json'], { cwd: timeoutDir });
  const timed = runHook(timeoutDir, { HISFM_GATE_TIMEOUT_MS: '800' });
  check('timeout rejects and cleans', timed.status === 124 && snapshotGone(timed.leftovers), timed.output);

  const missingDir = fixture('missing-npm');
  const missingBin = join(owned, 'bin');
  mkdirSync(missingBin, { recursive: true });
  symlinkSync(process.execPath, join(missingBin, 'node'));
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(missingBin, 'git'));
  const missing = runHook(missingDir, { PATH: `${missingBin}:/usr/bin:/bin` });
  check(
    'missing npm rejects and cleans',
    missing.status === 127 && snapshotGone(missing.leftovers),
    missing.output,
  );

  check('root hooks unchanged', rootHooks() === hooksBefore && hooksBefore === '.husky/_', rootHooks());
  check('root index untouched', rootIndex() === indexBefore);
} finally {
  rmSync(owned, { recursive: true, force: true });
}

if (failed) process.exit(failed);
console.log('gate helper passed');
