import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const appDir = join(import.meta.dirname, '..');
const persistDir = '.cloudflare/e2e-state';
const databaseId = '66f7e201-22a8-450d-838d-ecbc382afbc6';
const viteBin = join(dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin/vite.js');

const env = {
  ...process.env,
  MINIFLARE_CACHE_DIR: '.cloudflare/cache',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  CLOUDFLARE_PERSIST_STATE: persistDir,
};

rmSync(join(appDir, persistDir), { recursive: true, force: true });

const episodes = [
  {
    id: 'ci-episode-01',
    slug: 'how-many-ai-tools-after-work',
    episodeNumber: 1,
    title: '下班后，还要追多少个 AI？',
    summary: '十一点半，收藏夹又多了一条教程。聊聊睡眠、消息与那个总觉得自己还不够努力的晚上。',
    transcript: '这是仅用于后台验证的测试逐字稿内容，不应出现在公开接口中。',
    lead: '下班又打开了新工具的教程，我们先看看哪些边界真正重要。',
    researchNote: 'CI 冒烟测试样本：仅验证公开页面渲染与接口隔离。',
    coverUrl: '/images/episode-01.webp',
    category: 'manager-notes',
    tags: ['AI 学习', '工作节奏'],
    durationSeconds: 600,
    featured: 1,
    publishedAt: '2026-09-24T08:00:00.000Z',
    topics: [
      { title: '先确认休息边界', detail: '把晚上的时间留给睡眠，而不是无限刷新的工具清单。' },
      { title: '少追两条消息', detail: '把注意力收回当前正在做的那件事。' },
    ],
  },
  {
    id: 'ci-episode-02',
    slug: 'a-walk-without-a-goal',
    episodeNumber: 1,
    title: '散个步，不必顺便成为更好的自己',
    summary: '路线不用记录，耳机可以摘掉。去看看路边的树，是不是已经换了一点颜色。',
    transcript: '这是仅用于后台验证的第二条测试逐字稿。',
    lead: '没有必须完成的步数，等想回家的时候，就回家。',
    researchNote: 'CI 冒烟测试样本：验证栏目筛选与详情页路由。',
    coverUrl: '/images/episode-02.webp',
    category: 'life',
    tags: ['散步', '日常'],
    durationSeconds: 840,
    featured: 0,
    publishedAt: '2026-09-21T08:00:00.000Z',
    topics: [{ title: '不带目标出门', detail: '留一段不被记录的傍晚时间。' }],
  },
];

const quote = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);
const seedStatements = episodes.flatMap((episode) => {
  const values = [
    quote(episode.id),
    quote(episode.slug),
    episode.episodeNumber,
    quote(episode.title),
    quote(episode.summary),
    quote(episode.transcript),
    quote(episode.lead),
    quote(episode.researchNote),
    quote(''),
    quote(''),
    quote(episode.coverUrl),
    quote(episode.category),
    quote(JSON.stringify(episode.tags)),
    episode.durationSeconds,
    'NULL',
    quote('published'),
    episode.featured,
    quote(episode.publishedAt),
    quote(episode.publishedAt),
    quote(episode.publishedAt),
    1,
    quote(`ci-write-${episode.id}`),
  ];
  const insertEpisode = `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, lead, research_note, credits, body, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, version, write_id) VALUES (${values.join(', ')});`;
  const insertClaim = `INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (${quote(episode.category)}, ${episode.episodeNumber}, ${quote(episode.id)}, 'episode');`;
  const insertTopics = episode.topics.map(
    (topic, index) =>
      `INSERT INTO episode_topics (episode_id, position, title, detail, source_urls) VALUES (${quote(episode.id)}, ${index + 1}, ${quote(topic.title)}, ${quote(topic.detail)}, '[]');`,
  );
  return [insertEpisode, insertClaim, ...insertTopics];
});

const miniflare = new Miniflare({
  resourcePersistencePath: join(appDir, persistDir, 'v3'),
  workers: [
    {
      config: {
        name: 'hisfm-e2e-seed',
        compatibilityDate: '2026-09-24',
        manifest: {
          mainModule: 'index.js',
          modules: {
            'index.js': {
              type: 'esm',
              contents: 'export default { fetch() { return new Response("ok"); } }',
            },
          },
        },
        env: {
          DB: { type: 'd1', name: 'his-fm', id: databaseId },
        },
      },
    },
  ],
});

try {
  const { DB: db } = await miniflare.getBindings();
  const migrationsDir = join(appDir, 'migrations');
  for (const name of readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    const statements = readFileSync(join(migrationsDir, name), 'utf8')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length > 0) {
      await db.batch(statements.map((statement) => db.prepare(statement)));
    }
  }
  await db.batch(seedStatements.map((statement) => db.prepare(statement)));
} finally {
  await miniflare.dispose();
}

const child = spawn(
  process.execPath,
  [viteBin, 'preview', '--mode', 'development', '--host', '127.0.0.1', '--port', '27056', '--strictPort'],
  { cwd: appDir, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
