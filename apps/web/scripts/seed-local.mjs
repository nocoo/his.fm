import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

const root = join(import.meta.dirname, '..');
const marker = 'hisfm-website-preview-v1';
const transcript = readFileSync(
  new URL('../../../episodes/001-how-to-live-better/transcript.md', import.meta.url),
  'utf8',
);
const showNotes = readFileSync(
  new URL('../../../episodes/001-how-to-live-better/summary.md', import.meta.url),
  'utf8',
);
const published = [
  {
    slug: 'how-many-ai-tools-after-work',
    title: '下班后，还要追多少个 AI？',
    summary:
      '十一点半，收藏夹又多了一条教程。沿着《高性价比人生指南》，聊聊睡眠、消息与那个总觉得自己还不够努力的晚上。',
    category: 'manager-notes',
    tags: ['AI 学习', '工作节奏', '注意力'],
    duration: 600,
    transcript,
    showNotes,
  },
  {
    slug: 'a-walk-without-a-goal',
    title: '散个步，不必顺便成为更好的自己',
    summary: '路线不用记录，耳机可以摘掉。今天先把那些待办留在桌上，去看看路边的树，是不是已经换了一点颜色。',
    category: 'life',
    tags: ['散步', '下班以后', '日常'],
    duration: 840,
    transcript:
      '这是一期本地预览样稿。\n\n下班以后，你习惯往哪个方向走？这次试着走一条没有目的地的路。经过熟悉的路口时，看看常去的店有没有开门，听听傍晚街道上的声音。\n\n这期准备聊聊散步中的小发现。没有必须完成的步数，也不用向谁证明今晚安排得很充实。等想回家的时候，就回家。',
    showNotes: '本地预览选题：下班后的散步、熟悉街道里的新发现，以及不需要记录的日常。\n\n本期音频尚未制作。',
  },
  {
    slug: 'when-the-model-says-done',
    title: 'AI 说写完了，然后呢？',
    summary:
      '从一段看起来很漂亮的代码开始，聊模型交付之后的那半份工作：读懂、验证，以及敢于说这段我还没想明白。',
    category: 'learning',
    tags: ['开发现场', '代码审查', '学会验证'],
    duration: 1080,
    transcript:
      '这是一期本地预览样稿。\n\n模型在十几秒里交出一整页代码，光标停了下来，工作却还没有结束。你得看懂输入从哪里来，错误会怎样发生，以及同事明天是否能接着改。\n\n可以先挑一条最普通的用户路径，从头走一遍，再试一个空输入。把看不明白的地方留下来，一次问清一个问题。生成速度值得高兴，理解也值得安排时间。',
    showNotes: '本地预览选题：AI 辅助开发里的验证过程、具体测试案例和团队代码沟通。\n\n本期音频尚未制作。',
  },
  {
    slug: 'dinner-before-the-next-prompt',
    title: '下一条 Prompt 之前，先好好吃饭',
    summary: '电脑合上了，脑子还在继续运行。聊一顿不看屏幕的晚饭，以及工作怎样真正结束在今天。',
    category: 'life',
    tags: ['晚饭', '屏幕之外', '生活节奏'],
    duration: 780,
    transcript:
      '这是一期本地预览样稿。\n\n饭已经摆上桌，消息提醒还在闪。你想着回复最后一条，又顺手打开了另一个窗口。等再抬头，菜已经凉了。\n\n今晚试着给饭桌留出一点位置。把要继续的工作记在纸上，吃完再决定是否打开电脑。和一起吃饭的人聊聊今天发生的小事，也可以安静吃完。',
    showNotes: '本地预览选题：结束工作的动作、饭桌上的注意力，以及下班之后的具体安排。\n\n本期音频尚未制作。',
  },
  {
    slug: 'the-question-in-code-review',
    title: 'Code Review 里，那句没敢问出口的话',
    summary: '有些问题在脑子里转了很久，却没有发进评论区。一起聊聊怎样把“不明白”说具体，让讨论真正开始。',
    category: 'conversations',
    tags: ['同事之间', '沟通', 'Code Review'],
    duration: 1320,
    transcript:
      '这是一期本地预览样稿，并非真实访谈记录。\n\n打开同事的提交，有一段逻辑你看了三遍。评论框已经点开，打了半句又删掉。担心的问题有很多：是不是只有我不懂，会不会耽误大家。\n\n或许可以从描述理解开始：我目前理解这段是在处理重复请求，但还没想清楚超时后会发生什么。这比一句“这里不对”更容易展开讨论，也给自己留下重新理解的余地。',
    showNotes:
      '本地预览选题：开发者之间的日常沟通。尚未录制访谈，不使用虚构嘉宾或引语。\n\n本期音频尚未制作。',
  },
  {
    slug: 'leave-a-small-note-for-tomorrow',
    title: '给明天的自己，留一条小纸条',
    summary: '不写宏大的计划，只记下今天停在哪里。关于上下文、交接，以及一个不必从零开始的早晨。',
    category: 'manager-notes',
    tags: ['工作习惯', '上下文', '明天再说'],
    duration: 660,
    transcript:
      '这是一期本地预览样稿。\n\n到了下班时间，问题还没完全解决。你可以留下几句话：现在看到了什么，已经试过哪些办法，下一步最想确认什么。\n\n明天打开项目的时候，这几句话会替你保存今天的思路。它不用写成完整报告，只要那个隔了一夜的自己还能读懂。今天的工作就先停在这里。',
    showNotes: '本地预览选题：保存工作上下文的简短记录，以及可接续的个人工作习惯。\n\n本期音频尚未制作。',
  },
];

const quote = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);
const statements = published.map((episode, index) => {
  const timestamp = `2026-09-${String(24 - index * 3).padStart(2, '0')}T08:00:00.000Z`;
  const values = [
    `local-episode-${String(index + 1).padStart(2, '0')}`,
    episode.slug,
    index + 1,
    episode.title,
    episode.summary,
    episode.transcript,
    episode.showNotes,
    `https://f.no.mt/images/episode-${String((index % 3) + 1).padStart(2, '0')}.webp`,
    episode.category,
    JSON.stringify(episode.tags),
    episode.duration,
    null,
    'published',
    index === 0 ? 1 : 0,
    timestamp,
    timestamp,
    timestamp,
  ];
  return `INSERT OR IGNORE INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at) SELECT ${values.map(quote).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM local_seed_runs WHERE name = ${quote(marker)});`;
});
statements.push(
  `INSERT OR IGNORE INTO local_seed_runs (name, created_at) VALUES (${quote(marker)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
);

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('bin/cf', import.meta.resolve('cf/package.json'))),
    'd1',
    'raw',
    '00000000-0000-4000-8000-000000007056',
    '--local',
    '--persist-to',
    '.cloudflare/state',
    '--sql',
    statements.join('\n'),
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
