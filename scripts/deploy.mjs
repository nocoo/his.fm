import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = new URL('../apps/web/', import.meta.url);
const { devDependencies } = JSON.parse(readFileSync(new URL('package.json', app), 'utf8'));
const cli = fileURLToPath(new URL('bin/cf', import.meta.resolve('cf/package.json')));
const reported = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
if (reported.match(/\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?/)?.[0] !== devDependencies.cf) {
  throw new Error('Project-local cf version does not match the web workspace manifest');
}
execFileSync('npm', ['run', 'deploy', '--workspace', '@his-fm/web'], { stdio: 'inherit' });
