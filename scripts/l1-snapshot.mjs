import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const coverageFloor = 95;
const coverageMetrics = ['statements', 'branches', 'functions', 'lines'];

const workspaceLinks = [
  ['web', 'apps/web'],
  ['contracts', 'packages/contracts'],
];

const workspaceNestedRoots = ['apps/web/node_modules', 'packages/contracts/node_modules'];

/** Resolve Vitest json-summary paths inside a gate snapshot. */
export function coverageReportTargets(snapshot) {
  const targets = [];
  if (existsSync(join(snapshot, 'apps/web/vitest.config.ts'))) {
    targets.push({
      label: '@his-fm/web',
      path: join(snapshot, 'apps/web/coverage/coverage-summary.json'),
    });
  }
  if (existsSync(join(snapshot, 'packages/contracts/vitest.config.ts'))) {
    targets.push({
      label: '@his-fm/contracts',
      path: join(snapshot, 'packages/contracts/coverage/coverage-summary.json'),
    });
  }
  if (targets.length === 0 && existsSync(join(snapshot, 'vitest.config.ts'))) {
    targets.push({ label: 'root', path: join(snapshot, 'coverage/coverage-summary.json') });
  }
  return targets;
}

/** Enforce four-metric floors from committed coverage output, independent of Vitest config. */
export function validateCoverageReports(snapshot) {
  const targets = coverageReportTargets(snapshot);
  if (targets.length === 0) {
    throw new Error('coverage targets are required');
  }
  for (const { label, path } of targets) {
    if (!existsSync(path)) {
      throw new Error(`missing coverage report for ${label}`);
    }
    let summary;
    try {
      summary = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(`malformed coverage report for ${label}`);
    }
    const total = summary?.total;
    if (!total) {
      throw new Error(`missing coverage totals for ${label}`);
    }
    for (const metric of coverageMetrics) {
      const entry = total[metric];
      if (!entry) {
        throw new Error(`missing coverage metric ${metric} for ${label}`);
      }
      if (entry.pct === 'Unknown') {
        throw new Error(`coverage ${metric} has no exercised sources for ${label}`);
      }
      if (typeof entry.pct !== 'number' || entry.pct < coverageFloor) {
        throw new Error(`coverage ${metric} ${entry.pct}% below ${coverageFloor}% for ${label}`);
      }
    }
  }
}

/** Link live node_modules into an L1 gate snapshot without mutating the working tree. */
export function linkSnapshotNodeModules(root, snapshot) {
  const modules = join(snapshot, 'node_modules');
  if (existsSync(modules)) {
    throw new Error('snapshot must not contain node_modules');
  }
  mkdirSync(modules);
  const liveRootModules = join(root, 'node_modules');
  for (const entry of readdirSync(liveRootModules)) {
    if (entry !== '@his-fm') {
      symlinkSync(join(liveRootModules, entry), join(modules, entry));
    }
  }
  mkdirSync(join(modules, '@his-fm'));
  for (const [name, directory] of workspaceLinks) {
    if (existsSync(join(snapshot, directory, 'package.json'))) {
      symlinkSync(join(snapshot, directory), join(modules, '@his-fm', name));
    }
  }
  for (const nested of workspaceNestedRoots) {
    const liveNested = join(root, nested);
    if (!existsSync(liveNested)) continue;
    const snapNested = join(snapshot, nested);
    mkdirSync(snapNested, { recursive: true });
    for (const entry of readdirSync(liveNested)) {
      const snapEntry = join(snapNested, entry);
      if (existsSync(snapEntry)) continue;
      symlinkSync(join(liveNested, entry), snapEntry);
    }
  }
}
