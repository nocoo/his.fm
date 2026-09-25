import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const expectedRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

const response = await fetch('https://his.fm/api/live', {
  headers: { Accept: 'application/json' },
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) {
  console.error(`api/live HTTP ${response.status}`);
  process.exit(1);
}
const live = await response.json();

const expectations = [
  ['status', 'ok'],
  ['service', 'his.fm'],
  ['version', expectedVersion],
  ['revision', expectedRevision],
];

let failed = false;
for (const [field, want] of expectations) {
  const got = live?.[field];
  const ok = got === want;
  console.log(
    `${ok ? 'ok' : 'FAIL'} ${field}: ${JSON.stringify(got)}${ok ? '' : ` expected ${JSON.stringify(want)}`}`,
  );
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log('live verification passed');
