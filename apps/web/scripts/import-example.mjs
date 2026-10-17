import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildImportExampleStatements } from './import-example-sql.mjs';

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

const mode = process.argv[2];
if (!['--local', '--remote'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/import-example.mjs --local|--remote');
}
const read = (name) =>
  readFileSync(
    new URL(`../../../episodes/001-how-to-live-better/${name}.md`, import.meta.url),
    'utf8',
  ).trim();
const manuscript = read('transcript');
const description = read('summary');
const research = read('research');
const title = manuscript.split('\n')[0].replace(/^#\s+/, '');
const now = new Date().toISOString();
const production = {
  id: 'example-how-to-live-better',
  version: 1,
  stage: 'draft',
  title,
  slug: 'how-to-live-better',
  category: 'manager-notes',
  tags: ['AI 学习', '工作节奏', '睡眠', '注意力', '休息'],
  targetDurationSeconds: 600,
  sources: [
    {
      id: 'example-research-link',
      type: 'github',
      title: 'HowToLiveBetter — researched revision',
      content:
        'https://github.com/eternity4719/HowToLiveBetter/tree/6576d14715d61bf70d05cfeb7e6f45cd88e24e7f',
    },
    {
      id: 'example-research-notes',
      type: 'text',
      title: 'Research notes and primary-source verification',
      content: research,
    },
  ],
  intent:
    '从 AI 转型压力之下的年轻程序员视角，切入下班后还在追赶新工具的夜晚。沿着 HowToLiveBetter，讲清睡眠、邮件查看节奏和呼吸练习的真实研究、适用条件与证据边界。将项目引申到学习任务、团队沟通、晚饭和休息；中文单人讲述，约十分钟，具体自然，不把生活变成另一张任务表。',
  transcript: manuscript.replace(/^#\s+[^\n]+\n+/, ''),
  scriptVersion: 1,
  description,
  summary: description.split('## 发表摘要\n')[1].split('\n## ')[0].trim(),
  assets: { cover: null, audio: null },
  approvals: { brief: null, script: null, final: null },
  publications: [],
  events: [
    {
      id: 'example-import',
      at: now,
      actor: { kind: 'agent', name: 'Example import' },
      action: 'import_existing_materials',
      feedback:
        'Imported the existing manuscript, description and verified research. No human approval or publication has been recorded.',
    },
  ],
  createdAt: now,
  updatedAt: now,
};
const importWriteId = randomBytes(16).toString('hex');
const sql = buildImportExampleStatements(production, { mode, now, importWriteId });
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('bin/cf', import.meta.resolve('cf/package.json'))),
    'd1',
    'raw',
    mode === '--local' ? '00000000-0000-4000-8000-000000007056' : '66f7e201-22a8-450d-838d-ecbc382afbc6',
    ...(mode === '--local' ? ['--local', '--persist-to', '.cloudflare/state'] : []),
    '--sql',
    sql.join('\n'),
  ],
  { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
