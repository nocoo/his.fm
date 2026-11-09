import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
import { coverageReportTargets, linkSnapshotNodeModules, validateCoverageReports } from './l1-snapshot.mjs';

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
  const text = ok ? detail.replace(/\s+/g, ' ').slice(0, 240) : detail.trim();
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
  const tsconfig = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
  tsconfig.compilerOptions.typeRoots = [
    join(repo, 'apps/web/node_modules/@types'),
    join(repo, 'node_modules/@types'),
    join(repo, 'node_modules'),
  ];
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
  const biome = JSON.parse(readFileSync(join(repo, 'biome.json'), 'utf8'));
  biome.files.includes = ['src/**', 'scripts/**', '*.json', '*.ts'];
  writeFileSync(join(dir, 'biome.json'), `${JSON.stringify(biome, null, 2)}\n`);
  execFileSync(join(repo, 'node_modules/.bin/biome'), ['format', '--write', 'biome.json', 'tsconfig.json'], {
    cwd: dir,
  });
  writeFileSync(join(dir, 'scripts/check-staged.mjs'), readFileSync(join(repo, 'scripts/check-staged.mjs')));
  writeFileSync(join(dir, 'scripts/l1-snapshot.mjs'), readFileSync(join(repo, 'scripts/l1-snapshot.mjs')));
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
  if (extra.gapFile) {
    mkdirSync(join(dir, extra.gapDir ?? 'src/shared'), { recursive: true });
    writeFileSync(join(dir, extra.gapFile.path), extra.gapFile.source);
  }
  if (extra.extraTest) {
    mkdirSync(join(dir, 'src/shared'), { recursive: true });
    writeFileSync(join(dir, 'src/shared/extra.test.ts'), extra.extraTest);
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

function runHookSignaled(dir, signal, env = {}) {
  const scratch = scratchOf(dir);
  return new Promise((resolve) => {
    const child = spawn('sh', ['.husky/pre-commit'], {
      cwd: dir,
      env: { ...process.env, TMPDIR: scratch, ...env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, signal);
      } catch {}
    }, 400);
    child.on('exit', (code, gotSignal) => {
      clearTimeout(timer);
      resolve(
        resultOf(scratch, {
          status: gotSignal ? 143 : (code ?? 1),
          stdout,
          stderr,
        }),
      );
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(resultOf(scratch, { status: 127, stdout, stderr }));
    });
  });
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

await (async () => {
  try {
    const healthyDir = fixture('healthy');
    const healthy = runHook(healthyDir);
    check('healthy real gate exits 0', healthy.status === 0, healthy.output);
    check('healthy snapshot removed', snapshotGone(healthy.leftovers), healthy.leftovers.join(','));

    const validCovRoot = mkdtempSync(join(owned, 'valid-cov-'));
    writeFileSync(join(validCovRoot, 'vitest.config.ts'), 'export default {}\n');
    mkdirSync(join(validCovRoot, 'coverage'), { recursive: true });
    writeFileSync(
      join(validCovRoot, 'coverage/coverage-summary.json'),
      `${JSON.stringify({
        total: {
          statements: { pct: 95, total: 10 },
          branches: { pct: 95, total: 10 },
          functions: { pct: 95, total: 10 },
          lines: { pct: 95, total: 10 },
        },
      })}\n`,
    );
    validateCoverageReports(validCovRoot);
    check('coverage validation accepts floors', true);
    const validTargets = coverageReportTargets(validCovRoot);
    check(
      'coverage target discovery',
      validTargets.length === 1 && validTargets[0].label === 'root',
      validTargets[0]?.label,
    );

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

    const branchGap = `export function sign(n: number): number {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}
`;
    const branchTest = `import { expect, it } from 'vitest';
import { sign } from './branch-gap';

it('positive only', () => {
  expect(sign(1)).toBe(1);
});
`;
    const branchDir = fixture('coverage-branches', {
      gapFile: { path: 'src/shared/branch-gap.ts', source: branchGap },
      extraTest: branchTest,
    });
    const branchCov = runHook(branchDir);
    check(
      'branch coverage shortfall rejects',
      branchCov.status !== 0 && /branch/i.test(branchCov.output),
      branchCov.output,
    );

    const functionGap = `export function alpha(): number {
  return 1;
}

export function beta(): number {
  return 2;
}
`;
    const functionTest = `import { expect, it } from 'vitest';
import { alpha } from './function-gap';

it('uses alpha', () => {
  expect(alpha()).toBe(1);
});
`;
    const functionDir = fixture('coverage-functions', {
      gapFile: { path: 'src/shared/function-gap.ts', source: functionGap },
      extraTest: functionTest,
    });
    const functionCov = runHook(functionDir);
    check(
      'function coverage shortfall rejects',
      functionCov.status !== 0 && /function/i.test(functionCov.output),
      functionCov.output,
    );

    const onlyDir = fixture('only', { test: passingTest.replace("it('accepts", "it.only('accepts") });
    const only = runHook(onlyDir);
    check('vitest .only rejects', only.status !== 0 && /only/i.test(only.output), only.output);

    const skipDir = fixture('skip', { test: passingTest.replace("it('accepts", "it.skip('accepts") });
    const skip = runHook(skipDir);
    check(
      'vitest skip-only rejects via coverage validation',
      skip.status !== 0 && /no exercised sources|coverage/i.test(skip.output),
      skip.output,
    );

    const noCovDir = fixture('no-coverage-script');
    writeFileSync(
      join(noCovDir, 'package.json'),
      `${JSON.stringify(
        {
          type: 'module',
          scripts: {
            'test:coverage': 'vitest run',
            lint: 'biome check . --error-on-warnings',
            typecheck: 'tsc --noEmit',
          },
        },
        null,
        2,
      )}\n`,
    );
    execFileSync('git', ['add', '--', 'package.json'], { cwd: noCovDir });
    const noCov = runHook(noCovDir);
    check(
      'missing coverage report rejects',
      noCov.status !== 0 && /missing coverage report|pre-commit: missing coverage report/i.test(noCov.output),
      noCov.output,
    );

    const lineGap = `export function lines(): string {
  if (Math.random() > 0.5) return 'a';
  return 'b';
}
`;
    const lineTest = `import { expect, it } from 'vitest';
import { lines } from './line-gap';

it('samples once', () => {
  expect(typeof lines()).toBe('string');
});
`;
    const lineDir = fixture('coverage-lines', {
      gapFile: { path: 'src/shared/line-gap.ts', source: lineGap },
      extraTest: lineTest,
    });
    const lineCov = runHook(lineDir);
    check(
      'line coverage shortfall rejects',
      lineCov.status !== 0 && /line/i.test(lineCov.output),
      lineCov.output,
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
    check(
      'type probe preserves worktree',
      readFileSync(join(typeDir, 'src/admin/model.ts'), 'utf8') === model,
    );

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

    const interruptDir = fixture('interrupt');
    writeFileSync(
      join(interruptDir, 'package.json'),
      `${JSON.stringify(
        {
          type: 'module',
          scripts: {
            'test:coverage': 'node -e "setInterval(() => {}, 1000)"',
            lint: 'node -e 0',
            typecheck: 'node -e 0',
          },
        },
        null,
        2,
      )}\n`,
    );
    execFileSync('git', ['add', '--', 'package.json'], { cwd: interruptDir });
    const interrupted = await runHookSignaled(interruptDir, 'SIGTERM');
    check(
      'interrupt rejects and cleans',
      interrupted.status === 143 && snapshotGone(interrupted.leftovers),
      interrupted.output,
    );

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

    const snapRoot = mkdtempSync(join(owned, 'snapshot-root-'));
    const liveRootModules = join(snapRoot, 'node_modules');
    const liveWebModules = join(snapRoot, 'apps/web/node_modules');
    mkdirSync(join(liveWebModules, '@types/node'), { recursive: true });
    mkdirSync(join(liveRootModules, '@types/node'), { recursive: true });
    writeFileSync(
      join(liveWebModules, '@types/node/package.json'),
      '{"name":"@types/node","version":"26.6.5"}\n',
    );
    writeFileSync(
      join(liveRootModules, '@types/node/package.json'),
      '{"name":"@types/node","version":"26.6.3"}\n',
    );
    writeFileSync(join(snapRoot, 'package.json'), '{"name":"his-fm"}\n');
    writeFileSync(join(snapRoot, 'apps/web/package.json'), '{"name":"@his-fm/web"}\n');
    mkdirSync(join(liveRootModules, '@his-fm'), { recursive: true });
    const modulesBefore = readdirSync(liveRootModules).sort().join(',');
    const snapDir = mkdtempSync(join(snapRoot, 'gate-'));
    writeFileSync(join(snapDir, 'package.json'), '{"name":"his-fm"}\n');
    mkdirSync(join(snapDir, 'apps/web'), { recursive: true });
    writeFileSync(join(snapDir, 'apps/web/package.json'), '{"name":"@his-fm/web"}\n');
    linkSnapshotNodeModules(snapRoot, snapDir);
    const nestedVersion = JSON.parse(
      readFileSync(join(snapDir, 'apps/web/node_modules/@types/node/package.json'), 'utf8'),
    ).version;
    check('L1 snapshot prefers workspace nested @types/node', nestedVersion === '26.6.5');
    const modulesAfter = readdirSync(liveRootModules).sort().join(',');
    check('L1 snapshot does not mutate working-tree scopes', modulesBefore === modulesAfter);
    rmSync(snapDir, { recursive: true, force: true });
    rmSync(snapRoot, { recursive: true, force: true });

    const stagedHelperDir = fixture('staged-l1-helper');
    const helperPath = join(stagedHelperDir, 'scripts/l1-snapshot.mjs');
    const goodHelper = readFileSync(helperPath, 'utf8');
    rmSync(helperPath);
    const deletedHelper = runHook(stagedHelperDir);
    check('L1 gate ignores unstaged l1-snapshot deletion', deletedHelper.status === 0, deletedHelper.output);
    writeFileSync(
      helperPath,
      'export function linkSnapshotNodeModules() {\n  throw new Error("worktree poison");\n}\n',
    );
    const poisonedHelper = runHook(stagedHelperDir);
    check('L1 gate ignores unstaged l1-snapshot edits', poisonedHelper.status === 0, poisonedHelper.output);
    writeFileSync(helperPath, goodHelper);
    writeFileSync(
      helperPath,
      'export function linkSnapshotNodeModules() {\n  throw new Error("staged poison");\n}\n',
    );
    execFileSync('git', ['add', '--', 'scripts/l1-snapshot.mjs'], { cwd: stagedHelperDir });
    writeFileSync(helperPath, goodHelper);
    const stagedPoison = runHook(stagedHelperDir);
    check(
      'L1 gate uses staged l1-snapshot when worktree differs',
      stagedPoison.status !== 0,
      stagedPoison.output,
    );
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }

  if (failed) process.exit(failed);
  console.log('gate helper passed');
})();
