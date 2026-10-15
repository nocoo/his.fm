import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const workspaceLinks = [
  ['web', 'apps/web'],
  ['contracts', 'packages/contracts'],
  ['agent', 'packages/agent'],
];

const workspaceNestedRoots = [
  'apps/web/node_modules',
  'packages/agent/node_modules',
  'packages/contracts/node_modules',
];

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
