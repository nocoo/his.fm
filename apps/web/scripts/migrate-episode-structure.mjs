#!/usr/bin/env node
/**
 * Backfills the structured episode fields from the legacy `show_notes` Markdown.
 *
 *   node scripts/migrate-episode-structure.mjs --review [--remote]
 *   node scripts/migrate-episode-structure.mjs --apply  [--remote] [--force]
 *
 * `--review` only reads the database and writes a human review file under `.local/migration/`.
 * `--apply` writes the four prose columns, the topic and mention rows, and the matching
 * production fields. It never touches `show_notes`, `mentions`, approvals, publications,
 * versions or any published timestamp, so the previous rendering path keeps working.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const remoteDatabase = '66f7e201-22a8-450d-838d-ecbc382afbc6';
const localState = '.cloudflare/state/v3/d1/miniflare-D1DatabaseObject';
const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const apply = args.has('--apply');
const force = args.has('--force');
const root = join(import.meta.dirname, '..');
const outputDir = join(root, '..', '..', '.local', 'migration', remote ? 'remote' : 'local');

const maxTopicTitle = 120;
const maxTopicDetail = 2000;

function localDatabaseFile() {
  const metadata = execFileSync('bash', ['-lc', `ls ${localState}/*.sqlite`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const seeded = metadata.find((file) => {
    try {
      const count = execFileSync('sqlite3', [file, 'SELECT count(*) FROM episodes;'], { encoding: 'utf8' });
      return Number(count.trim()) > 0;
    } catch {
      return false;
    }
  });
  if (!seeded) throw new Error(`No seeded local D1 database found under ${localState}`);
  return seeded;
}

function query(sql) {
  if (remote) {
    const out = execFileSync('cf', ['d1', 'query', remoteDatabase, '--sql', sql], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
    return JSON.parse(out.slice(out.indexOf('[')))[0].results;
  }
  const out = execFileSync('sqlite3', ['-json', localDatabaseFile(), sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
}

function writeStatements(statements) {
  if (!statements.length) return;
  if (remote) {
    const file = join(outputDir, 'batch.json');
    writeFileSync(
      file,
      JSON.stringify(
        statements.map(({ sql, params }) => ({ sql, params: params.map((value) => value ?? null) })),
      ),
    );
    const out = execFileSync('cf', ['d1', 'query', remoteDatabase, '--batch', `@${file}`], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
    if (/"success":\s*false/.test(out)) throw new Error(out.slice(0, 2000));
    return;
  }
  const statementsSql = statements
    .map(({ sql, params }) => {
      const parts = sql.split('?');
      if (parts.length - 1 !== params.length) throw new Error(`placeholder mismatch: ${sql}`);
      let rendered = parts[0];
      params.forEach((value, index) => {
        rendered +=
          (value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`) +
          parts[index + 1];
      });
      return `${rendered};`;
    })
    .join('\n');
  execFileSync('sqlite3', [localDatabaseFile()], { input: statementsSql });
}

const heading = /^#{1,6}\s+(.*)$/;
const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const sourceLine = /^\s*来源[:：]\s*(.*)$/;
const narration = /旁白[:：]\s*([^。]+)。?/;
const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function clean(text) {
  return text
    .replace(markdownLink, (_, label) => label)
    .replace(/\s+/g, ' ')
    .trim();
}

function links(text) {
  const urls = [];
  for (const match of text.matchAll(markdownLink)) urls.push(match[2]);
  for (const match of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) urls.push(match[1]);
  for (const match of text.matchAll(/(?:^|[\s、，,（(])(https?:\/\/[^\s、，,）)]+)/g)) urls.push(match[1]);
  return [...new Set(urls.filter((url) => url.startsWith('https://')))];
}

function splitItem(raw) {
  const text = clean(raw);
  if (text.length < 4) return null;
  const urls = links(raw);
  const bold = /^\*\*(.+?)\*\*[:：]\s*(.*)$/.exec(text);
  if (bold) return { title: bold[1].trim(), detail: bold[2].trim(), sourceUrls: urls };
  const linkFirst = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)[:：]?\s*(.*)$/.exec(raw.trim());
  if (linkFirst)
    return {
      title: linkFirst[1].trim(),
      detail: linkFirst[3].trim(),
      sourceUrls: [...new Set([linkFirst[2], ...urls])],
    };
  const colon = text.search(/[:：]/);
  if (colon > 0 && colon <= 48) {
    return { title: text.slice(0, colon).trim(), detail: text.slice(colon + 1).trim(), sourceUrls: urls };
  }
  return { title: text, detail: '', sourceUrls: urls };
}

function parseBlocks(showNotes, title) {
  const state = { lead: [], topics: [], research: [], credits: [], body: [] };
  let current = 'lead';
  let pending = [];
  const flush = () => {
    if (current === 'topics') {
      for (const item of pending) {
        const entry = splitItem(item.text);
        if (!entry) continue;
        entry.sourceUrls = [...new Set([...entry.sourceUrls, ...item.urls])];
        state.topics.push(entry);
      }
    } else if (pending.length) {
      state[current].push(...pending.map((item) => item.text));
    }
    pending = [];
  };

  for (const line of showNotes.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current === 'topics' && pending.length) {
        const last = pending.at(-1);
        last.text += '\n';
      }
      continue;
    }
    const headingMatch = heading.exec(trimmed);
    if (headingMatch) {
      flush();
      const name = headingMatch[1].trim();
      if (/本期听点|本期讨论|收听提纲/.test(name)) current = 'topics';
      else if (/发表摘要|摘要|导语|开场/.test(name)) current = 'lead';
      else if (/说明|研究边界/.test(name)) current = 'research';
      else if (/音乐致谢|致谢|许可/.test(name)) current = 'credits';
      else if (name === title || /^每日手冲｜/.test(name)) current = 'lead';
      else current = 'body';
      if (current === 'body') state.body.push({ level: 2, text: name });
      continue;
    }
    if (/^本期听点[:：]\s*/.test(trimmed)) {
      flush();
      current = 'topics';
      const rest = trimmed.replace(/^本期听点[:：]\s*/, '');
      if (rest) pending.push({ text: rest, urls: [] });
      continue;
    }
    if (/^研究边界[:：]/.test(trimmed)) {
      flush();
      current = 'research';
      const rest = trimmed.replace(/^研究边界[:：]\s*/, '');
      if (rest) state.research.push(rest);
      continue;
    }
    if (/^上一期[:：]/.test(trimmed)) {
      flush();
      current = 'body';
      state.body.push(trimmed);
      continue;
    }
    if (/^(?:his\.fm · )?第\s*\d+\s*期/.test(trimmed) || /^中文单人播客/.test(trimmed)) {
      continue;
    }
    if (/^时长约/.test(trimmed)) {
      const voice = narration.exec(trimmed);
      if (voice) state.credits.push(`本期旁白：${voice[1].trim()}。`);
      continue;
    }
    if (/^本期旁白/.test(trimmed)) {
      flush();
      current = 'credits';
      state.credits.push(trimmed);
      continue;
    }
    const sourceMatch = sourceLine.exec(trimmed);
    if (sourceMatch) {
      const urls = links(sourceMatch[1]);
      if (current === 'topics' && pending.length) {
        pending.at(-1).urls.push(...urls);
        if (!urls.length) pending.at(-1).text += `\n来源：${sourceMatch[1]}`;
      } else {
        state.body.push(trimmed);
      }
      continue;
    }
    const bulletMatch = bullet.exec(line);
    if (bulletMatch) {
      if (current !== 'topics') {
        flush();
        current = 'body';
        state.body.push(trimmed);
        continue;
      }
      pending.push({ text: bulletMatch[1], urls: [] });
      continue;
    }
    if (current === 'topics') {
      if (pending.length) pending.at(-1).text += ` ${trimmed}`;
      else pending.push({ text: trimmed, urls: [] });
      continue;
    }
    state[current].push(trimmed);
  }
  flush();

  const join = (blocks) =>
    blocks
      .map((block) => (typeof block === 'string' ? block : `${'#'.repeat(block.level)} ${block.text}`))
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  if (!state.topics.length) {
    const bodyLines = state.body.filter((block) => typeof block === 'string');
    const start = bodyLines.findIndex((line, index, all) => {
      if (!/^- /.test(line)) return false;
      let run = 0;
      for (let cursor = index; cursor < all.length && /^- /.test(all[cursor]); cursor += 1) run += 1;
      return run >= 3;
    });
    if (start >= 0) {
      let end = start;
      while (end < bodyLines.length && /^- /.test(bodyLines[end])) end += 1;
      for (const line of bodyLines.slice(start, end)) {
        const entry = splitItem(line.replace(/^- /, ''));
        if (entry) state.topics.push(entry);
      }
      state.body = state.body.filter(
        (block) => typeof block !== 'string' || !bodyLines.slice(start, end).includes(block),
      );
    }
  }

  return {
    lead: join(state.lead),
    topics: state.topics
      .filter((topic) => topic.title.trim())
      .map((topic) => ({
        title: topic.title.slice(0, maxTopicTitle),
        detail: topic.detail.slice(0, maxTopicDetail),
        sourceUrls: topic.sourceUrls,
      })),
    researchNote: join(state.research),
    credits: join(state.credits),
    body: join(state.body),
  };
}

function parseEpisode(row) {
  const parsed = parseBlocks(row.show_notes, row.title);
  const warnings = [];
  if (!parsed.topics.length) warnings.push('未解析出听点');
  if (!parsed.lead) warnings.push('没有导语');
  if (!parsed.researchNote) warnings.push('没有研究边界');
  if (!parsed.credits) warnings.push('没有致谢');
  if (row.lead || row.research_note || row.credits || row.body) warnings.push('已有结构字段');
  return { parsed, warnings };
}

const overridesFile = join(outputDir, 'overrides.json');
const overrides = (() => {
  try {
    return JSON.parse(readFileSync(overridesFile, 'utf8'));
  } catch {
    return {};
  }
})();

const episodes = query(
  'SELECT id, category, episode_number, title, show_notes, mentions, source_production_id, lead, research_note, credits, body FROM episodes ORDER BY category, episode_number',
);
const productions = query('SELECT id, version, data FROM productions');
const existingTopics = query(
  'SELECT episode_id, position, title FROM episode_topics ORDER BY episode_id, position',
);
const existingMentions = query(
  'SELECT episode_id, count(*) AS count FROM episode_mentions GROUP BY episode_id',
);
const mentionCounts = new Map(existingMentions.map((row) => [row.episode_id, row.count]));
const topicsByEpisode = new Map();
for (const row of existingTopics) {
  const list = topicsByEpisode.get(row.episode_id) ?? [];
  list.push(row.title);
  topicsByEpisode.set(row.episode_id, list);
}

mkdirSync(outputDir, { recursive: true });

const review = [];
const statements = [];
const summary = [];

for (const episode of episodes) {
  const override = overrides[episode.id] ?? {};
  const base = parseEpisode(episode);
  const parsed = { ...base.parsed, ...override };
  const alreadyMigrated = topicsByEpisode.has(episode.id) && episode.lead;
  summary.push({
    id: episode.id,
    title: episode.title,
    topics: parsed.topics.length,
    warnings: base.warnings,
  });

  review.push(
    [
      `## ${episode.category} · EP.${String(episode.episode_number).padStart(2, '0')} ${episode.title}`,
      '',
      `- id: \`${episode.id}\``,
      `- 原 show_notes: ${episode.show_notes.length} 字`,
      `- 已迁移: ${alreadyMigrated ? 'yes' : 'no'}`,
      `- 警告: ${base.warnings.length ? base.warnings.join('、') : '无'}`,
      '',
      `**导语**（${parsed.lead.length} 字）`,
      '',
      parsed.lead ? parsed.lead.slice(0, 400) + (parsed.lead.length > 400 ? '…' : '') : '_空_',
      '',
      `**听点**（${parsed.topics.length} 条）`,
      '',
      ...(parsed.topics.length
        ? parsed.topics.map(
            (topic, index) =>
              `${index + 1}. **${topic.title}**${topic.detail ? ` —— ${topic.detail.slice(0, 120)}${topic.detail.length > 120 ? '…' : ''}` : ''}${topic.sourceUrls.length ? `（来源 ${topic.sourceUrls.length}）` : ''}`,
          )
        : ['_空_']),
      '',
      `**研究边界**（${parsed.researchNote.length} 字）`,
      '',
      parsed.researchNote
        ? parsed.researchNote.slice(0, 300) + (parsed.researchNote.length > 300 ? '…' : '')
        : '_空_',
      '',
      `**致谢**（${parsed.credits.length} 字）`,
      '',
      parsed.credits ? parsed.credits.slice(0, 300) : '_空_',
      '',
      `**其余正文**（${parsed.body.length} 字）`,
      '',
      parsed.body ? parsed.body.slice(0, 400) + (parsed.body.length > 400 ? '…' : '') : '_空_',
      '',
    ].join('\n'),
  );

  const legacyMentions = JSON.parse(episode.mentions || '[]');
  if (apply && legacyMentions.length && (!mentionCounts.get(episode.id) || force)) {
    statements.push({ sql: 'DELETE FROM episode_mentions WHERE episode_id = ?', params: [episode.id] });
    legacyMentions.forEach((mention, index) => {
      statements.push({
        sql: 'INSERT INTO episode_mentions (episode_id, position, name, description, url) VALUES (?, ?, ?, ?, ?)',
        params: [episode.id, index + 1, mention.name, mention.description, mention.url ?? null],
      });
    });
  }

  if (!apply || (alreadyMigrated && !force)) continue;

  statements.push({
    sql: 'UPDATE episodes SET lead = ?, research_note = ?, credits = ?, body = ? WHERE id = ?',
    params: [parsed.lead, parsed.researchNote, parsed.credits, parsed.body, episode.id],
  });
  statements.push({ sql: 'DELETE FROM episode_topics WHERE episode_id = ?', params: [episode.id] });
  for (const [index, topic] of parsed.topics.entries()) {
    statements.push({
      sql: 'INSERT INTO episode_topics (episode_id, position, title, detail, source_urls) VALUES (?, ?, ?, ?, ?)',
      params: [episode.id, index + 1, topic.title, topic.detail, JSON.stringify(topic.sourceUrls)],
    });
  }
}

const productionById = new Map(productions.map((row) => [row.id, row]));
for (const episode of episodes) {
  if (!apply || !episode.source_production_id) continue;
  const production = productionById.get(episode.source_production_id);
  if (!production) continue;
  const data = JSON.parse(production.data);
  if (data.topics?.length && data.lead && !force) continue;
  const override = overrides[episode.id] ?? {};
  const parsed = { ...parseEpisode(episode).parsed, ...override };
  const next = {
    ...data,
    lead: parsed.lead,
    researchNote: parsed.researchNote,
    credits: parsed.credits,
    body: parsed.body,
    topics: parsed.topics,
  };
  statements.push({
    sql: 'UPDATE productions SET data = ? WHERE id = ?',
    params: [JSON.stringify(next), production.id],
  });
}

writeFileSync(join(outputDir, 'review.md'), review.join('\n'));
writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 1));

if (apply) {
  writeStatements(statements);
  console.log(`applied ${statements.length} statements to ${remote ? 'remote' : 'local'}`);
} else {
  console.log(`review written to ${join(outputDir, 'review.md')}`);
}
console.log(
  summary
    .map(
      (entry) =>
        `${entry.topics} 听点${entry.warnings.length ? ` · ${entry.warnings.join('/')}` : ''} · ${entry.title}`,
    )
    .join('\n'),
);
