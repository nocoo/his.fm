import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2];
if (!['--local', '--remote'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/import-example.mjs --local|--remote');
}
const read = (name) =>
  readFileSync(new URL(`../episodes/001-how-to-live-better/${name}.md`, import.meta.url), 'utf8').trim();
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
  slug: 'how-many-ai-tools-after-work',
  episodeNumber: 1,
  category: 'work',
  tags: ['AI 学习', '工作节奏', '睡眠', '注意力', '休息'],
  targetDurationSeconds: 600,
  sources: [
    {
      type: 'github',
      title: 'HowToLiveBetter — researched revision',
      content:
        'https://github.com/eternity4719/HowToLiveBetter/tree/6576d14715d61bf70d05cfeb7e6f45cd88e24e7f',
    },
    { type: 'text', title: 'Research notes and primary-source verification', content: research },
  ],
  intent:
    '从 AI 转型压力之下的年轻程序员视角，切入下班后还在追赶新工具的夜晚。沿着 HowToLiveBetter，讲清睡眠、邮件查看节奏和呼吸练习的真实研究、适用条件与证据边界。将项目引申到学习任务、团队沟通、晚饭和休息；中文单人讲述，约十分钟，具体自然，不把生活变成另一张任务表。',
  transcript: manuscript.replace(/^#\s+[^\n]+\n+/, ''),
  scriptVersion: 1,
  description,
  summary: description.split('## 发表摘要\n')[1].split('\n## ')[0].trim(),
  assets: { cover: null, audio: null },
  approvals: { brief: null, script: null, final: null },
  audioJob: null,
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
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const marker = 'hisfm-real-production-example-v1';
const localGuard =
  mode === '--local' ? ` AND NOT EXISTS (SELECT 1 FROM local_seed_runs WHERE name = ${quote(marker)})` : '';
const sql = [
  `INSERT OR IGNORE INTO productions (id, version, stage, data, created_at, updated_at) SELECT ${quote(production.id)}, 1, 'draft', ${quote(JSON.stringify(production))}, ${quote(now)}, ${quote(now)} WHERE NOT EXISTS (SELECT 1 FROM productions WHERE json_extract(data, '$.slug') = ${quote(production.slug)})${localGuard};`,
];
if (mode === '--local')
  sql.push(
    `INSERT OR IGNORE INTO local_seed_runs (name, created_at) VALUES (${quote(marker)}, ${quote(now)});`,
  );
const temporary = mkdtempSync(join(tmpdir(), 'hisfm-example-'));
try {
  const file = join(temporary, 'example.sql');
  writeFileSync(file, sql.join('\n'));
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'his-fm',
      mode,
      '--config',
      mode === '--local' ? 'wrangler.local.jsonc' : 'wrangler.jsonc',
      '--file',
      file,
    ],
    { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
