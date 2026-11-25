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

const workspaceNestedRoots = ['apps/web/node_modules', 'packages/contracts/node_modules'];

/** Overlay workspace-local installs (e.g. vitest) onto a fixture node_modules tree. */
function linkWorkspaceNestedModules(fixtureModules, root) {
  for (const nested of workspaceNestedRoots) {
    const liveNested = join(root, nested);
    if (!existsSync(liveNested)) continue;
    for (const entry of readdirSync(liveNested)) {
      if (entry === '.bin') {
        const fixtureBin = join(fixtureModules, '.bin');
        mkdirSync(fixtureBin, { recursive: true });
        for (const binEntry of readdirSync(join(liveNested, '.bin'))) {
          const target = join(fixtureBin, binEntry);
          if (existsSync(target)) continue;
          symlinkSync(join(liveNested, '.bin', binEntry), target);
        }
        continue;
      }
      const target = join(fixtureModules, entry);
      if (existsSync(target)) continue;
      symlinkSync(join(liveNested, entry), target);
    }
  }
}

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
  const fixtureModules = join(dir, 'node_modules');
  mkdirSync(fixtureModules);
  for (const entry of readdirSync(join(repo, 'node_modules'))) {
    if (entry === '@his-fm') continue;
    symlinkSync(join(repo, 'node_modules', entry), join(fixtureModules, entry));
  }
  linkWorkspaceNestedModules(fixtureModules, repo);
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

function runCommandAsync(command, args, dir, scratch, env = {}, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: dir,
      env: { ...process.env, TMPDIR: scratch, ...env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }, timeoutMs);
    child.on('close', (code, gotSignal) => {
      clearTimeout(timer);
      resolve(
        resultOf(scratch, {
          status: timedOut ? 124 : gotSignal ? 143 : (code ?? 1),
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

function runHookAsync(dir, env = {}) {
  const scratch = scratchOf(dir);
  return runCommandAsync('sh', ['.husky/pre-commit'], dir, scratch, env);
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
    child.on('close', (code, gotSignal) => {
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

async function commitHookAsync(dir) {
  const scratch = scratchOf(dir);
  const headBefore = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  const committed = await runCommandAsync('git', ['commit', '-m', 'probe'], dir, scratch);
  const headAfter = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return { ...committed, headBefore: headBefore.status, headAfter: headAfter.status };
}

async function runWithConcurrency(taskFns, concurrency = 4) {
  const results = new Array(taskFns.length);
  let next = 0;
  async function worker() {
    while (next < taskFns.length) {
      const index = next++;
      results[index] = await taskFns[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, taskFns.length) }, () => worker()));
  return results;
}

await (async () => {
  try {
    const validCovChecks = [];
    const validCovRoot = mkdtempSync(join(owned, 'valid-cov-'));
    writeFileSync(join(validCovRoot, 'vitest.config.ts'), 'export default {}\n');
    mkdirSync(join(validCovRoot, 'coverage'), { recursive: true });
    writeFileSync(
      join(validCovRoot, 'coverage/coverage-summary.json'),
      `${JSON.stringify({
        total: {
          statements: { pct: 80, total: 10 },
          branches: { pct: 80, total: 10 },
          functions: { pct: 80, total: 10 },
          lines: { pct: 80, total: 10 },
        },
      })}\n`,
    );
    validateCoverageReports(validCovRoot);
    validCovChecks.push(['coverage validation accepts floors', true]);
    const validTargets = coverageReportTargets(validCovRoot);
    validCovChecks.push([
      'coverage target discovery',
      validTargets.length === 1 && validTargets[0].label === 'root',
      validTargets[0]?.label,
    ]);

    const tasks = [
      async () => {
        const healthyDir = fixture('healthy');
        const healthy = await runHookAsync(healthyDir);
        return [
          ['healthy real gate exits 0', healthy.status === 0, healthy.output],
          ['healthy snapshot removed', snapshotGone(healthy.leftovers), healthy.leftovers.join(',')],
          ...validCovChecks,
        ];
      },
      async () => {
        const utDir = fixture('ut', { test: failingTest, worktreeTest: passingTest });
        const ut = await runHookAsync(utDir);
        return [
          ['staged UT failure rejects', ut.status !== 0 && ut.output.includes('FAIL'), ut.output],
          [
            'UT probe keeps unstaged fix',
            readFileSync(join(utDir, 'src/admin/model.test.ts'), 'utf8') === passingTest,
          ],
          [
            'UT probe keeps failing index',
            execFileSync('git', ['show', ':src/admin/model.test.ts'], {
              cwd: utDir,
              encoding: 'utf8',
            }).includes('toBe(false)'),
          ],
        ];
      },
      async () => {
        const gap = `export function uncovered(): number {\n  return 0;\n}\n`;
        const coverageDir = fixture('coverage', { gap });
        const coverage = await runHookAsync(coverageDir);
        return [
          [
            'coverage shortfall rejects',
            coverage.status !== 0 && /threshold/i.test(coverage.output),
            coverage.output,
          ],
        ];
      },
      async () => {
        const branchGap = `export function sign(n: number): number {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n`;
        const branchTest = `import { expect, it } from 'vitest';\nimport { sign } from './branch-gap';\n\nit('positive only', () => {\n  expect(sign(1)).toBe(1);\n});\n`;
        const branchDir = fixture('coverage-branches', {
          gapFile: { path: 'src/shared/branch-gap.ts', source: branchGap },
          extraTest: branchTest,
        });
        const branchCov = await runHookAsync(branchDir);
        return [
          [
            'branch coverage shortfall rejects',
            branchCov.status !== 0 && /branch/i.test(branchCov.output),
            branchCov.output,
          ],
        ];
      },
      async () => {
        const functionGap = `export function alpha(): number {\n  return 1;\n}\n\nexport function beta(): number {\n  return 2;\n}\n`;
        const functionTest = `import { expect, it } from 'vitest';\nimport { alpha } from './function-gap';\n\nit('uses alpha', () => {\n  expect(alpha()).toBe(1);\n});\n`;
        const functionDir = fixture('coverage-functions', {
          gapFile: { path: 'src/shared/function-gap.ts', source: functionGap },
          extraTest: functionTest,
        });
        const functionCov = await runHookAsync(functionDir);
        return [
          [
            'function coverage shortfall rejects',
            functionCov.status !== 0 && /function/i.test(functionCov.output),
            functionCov.output,
          ],
        ];
      },
      async () => {
        const onlyDir = fixture('only', { test: passingTest.replace("it('accepts", "it.only('accepts") });
        const only = await runHookAsync(onlyDir);
        return [['vitest .only rejects', only.status !== 0 && /only/i.test(only.output), only.output]];
      },
      async () => {
        const skipDir = fixture('skip', { test: passingTest.replace("it('accepts", "it.skip('accepts") });
        const skip = await runHookAsync(skipDir);
        return [
          [
            'vitest skip-only rejects via coverage validation',
            skip.status !== 0 && /no exercised sources|coverage/i.test(skip.output),
            skip.output,
          ],
        ];
      },
      async () => {
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
        const noCov = await runHookAsync(noCovDir);
        return [
          [
            'missing coverage report rejects',
            noCov.status !== 0 &&
              /missing coverage report|pre-commit: missing coverage report/i.test(noCov.output),
            noCov.output,
          ],
        ];
      },
      async () => {
        const lineGap = `export function lines(): string {\n  if (Math.random() > 0.5) return 'a';\n  return 'b';\n}\n`;
        const lineTest = `import { expect, it } from 'vitest';\nimport { lines } from './line-gap';\n\nit('samples once', () => {\n  expect(typeof lines()).toBe('string');\n});\n`;
        const lineDir = fixture('coverage-lines', {
          gapFile: { path: 'src/shared/line-gap.ts', source: lineGap },
          extraTest: lineTest,
        });
        const lineCov = await runHookAsync(lineDir);
        return [
          [
            'line coverage shortfall rejects',
            lineCov.status !== 0 && /line/i.test(lineCov.output),
            lineCov.output,
          ],
        ];
      },
      async () => {
        const lintDir = fixture('lint', { lint: `export function stop(): void {\n  debugger;\n}\n` });
        const lint = await runHookAsync(lintDir);
        return [
          ['biome lint error rejects', lint.status !== 0 && lint.output.includes('noDebugger'), lint.output],
        ];
      },
      async () => {
        const typeDir = fixture('type', { typed: `export const value: number = 'bad';\n` });
        const type = await runHookAsync(typeDir);
        return [
          ['tsc error rejects', type.status !== 0 && type.output.includes('TS2322'), type.output],
          [
            'type probe preserves worktree',
            readFileSync(join(typeDir, 'src/admin/model.ts'), 'utf8') === model,
          ],
        ];
      },
      async () => {
        const warningDir = fixture('warning', { css: `.badge {\n  color: red !important;\n}\n` });
        const warningHooks = installHusky(warningDir);
        const warning = await commitHookAsync(warningDir);
        return [
          ['fixture husky hooksPath', warningHooks === '.husky/_', warningHooks],
          [
            'husky commit rejects biome warning',
            warning.status !== 0 &&
              warning.output.includes('noImportantStyles') &&
              warning.output.includes('husky -'),
            warning.output,
          ],
          [
            'failed commit leaves HEAD',
            warning.headBefore !== 0 && warning.headAfter !== 0,
            String(warning.headAfter),
          ],
          ['warning snapshot removed', snapshotGone(warning.leftovers), warning.leftovers.join(',')],
        ];
      },
      async () => {
        const emptyDir = fixture('empty', { skipTest: true });
        const empty = await runHookAsync(emptyDir);
        return [
          ['empty suite rejects', empty.status !== 0 && /no test files/i.test(empty.output), empty.output],
          ['empty snapshot removed', snapshotGone(empty.leftovers), empty.leftovers.join(',')],
        ];
      },
      async () => {
        const timeoutDir = fixture('timeout');
        writeFileSync(
          join(timeoutDir, 'package.json'),
          `${JSON.stringify({ scripts: { 'test:coverage': 'node -e "setInterval(() => {}, 1000)"', lint: 'node -e 0', typecheck: 'node -e 0' } }, null, 2)}\n`,
        );
        execFileSync('git', ['add', '--', 'package.json'], { cwd: timeoutDir });
        const timed = await runHookAsync(timeoutDir, { HISFM_GATE_TIMEOUT_MS: '800' });
        return [
          ['timeout rejects and cleans', timed.status === 124 && snapshotGone(timed.leftovers), timed.output],
        ];
      },
      async () => {
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
        return [
          [
            'interrupt rejects and cleans',
            interrupted.status === 143 && snapshotGone(interrupted.leftovers),
            interrupted.output,
          ],
        ];
      },
      async () => {
        const missingDir = fixture('missing-npm');
        const missingBin = join(owned, 'bin');
        mkdirSync(missingBin, { recursive: true });
        symlinkSync(process.execPath, join(missingBin, 'node'));
        symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(missingBin, 'git'));
        const missing = await runHookAsync(missingDir, { PATH: `${missingBin}:/usr/bin:/bin` });
        return [
          [
            'missing npm rejects and cleans',
            missing.status === 127 && snapshotGone(missing.leftovers),
            missing.output,
          ],
        ];
      },
      async () => {
        const stagedHelperDir = fixture('staged-l1-helper');
        const helperPath = join(stagedHelperDir, 'scripts/l1-snapshot.mjs');
        const goodHelper = readFileSync(helperPath, 'utf8');
        rmSync(helperPath);
        const deletedHelper = await runHookAsync(stagedHelperDir);
        writeFileSync(
          helperPath,
          'export function linkSnapshotNodeModules() {\n  throw new Error("worktree poison");\n}\n',
        );
        const poisonedHelper = await runHookAsync(stagedHelperDir);
        writeFileSync(helperPath, goodHelper);
        writeFileSync(
          helperPath,
          'export function linkSnapshotNodeModules() {\n  throw new Error("staged poison");\n}\n',
        );
        execFileSync('git', ['add', '--', 'scripts/l1-snapshot.mjs'], { cwd: stagedHelperDir });
        writeFileSync(helperPath, goodHelper);
        const stagedPoison = await runHookAsync(stagedHelperDir);
        return [
          ['L1 gate ignores unstaged l1-snapshot deletion', deletedHelper.status === 0, deletedHelper.output],
          ['L1 gate ignores unstaged l1-snapshot edits', poisonedHelper.status === 0, poisonedHelper.output],
          [
            'L1 gate uses staged l1-snapshot when worktree differs',
            stagedPoison.status !== 0,
            stagedPoison.output,
          ],
        ];
      },
    ];

    const groups = await runWithConcurrency(tasks, 4);
    const snapshotChecks = [];
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
    snapshotChecks.push(['L1 snapshot prefers workspace nested @types/node', nestedVersion === '26.6.5']);
    const modulesAfter = readdirSync(liveRootModules).sort().join(',');
    snapshotChecks.push(['L1 snapshot does not mutate working-tree scopes', modulesBefore === modulesAfter]);
    rmSync(snapDir, { recursive: true, force: true });
    rmSync(snapRoot, { recursive: true, force: true });

    const stagedHelperChecks = groups.pop();
    for (const [name, ok, detail] of groups.flat()) {
      check(name, ok, detail);
    }
    check('root hooks unchanged', rootHooks() === hooksBefore && hooksBefore === '.husky/_', rootHooks());
    check('root index untouched', rootIndex() === indexBefore);
    for (const [name, ok, detail] of snapshotChecks) {
      check(name, ok, detail);
    }
    for (const [name, ok, detail] of stagedHelperChecks) {
      check(name, ok, detail);
    }
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }

  if (failed) process.exit(failed);
  console.log('gate helper passed');
})();
