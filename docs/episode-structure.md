# Episode structure

Episode bodies are stored as structure, not as one Markdown blob. This document records the model and
the migration that produced it.

## Model

Columns on `episodes`:

| Column | Purpose |
| --- | --- |
| `lead` | opening paragraph(s) that set up the episode |
| `research_note` | the 说明 / 研究边界 block: methodology and what the episode does not claim |
| `credits` | narration voice, music attribution, licence notes |
| `body` | any remaining Markdown that fits none of the above |

Child tables, ordered by `position`:

```sql
CREATE TABLE episode_topics (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  source_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_urls)),
  PRIMARY KEY (episode_id, position)
);

CREATE TABLE episode_mentions (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  url TEXT CHECK (url IS NULL OR (length(url) <= 2048 AND url LIKE 'http%')),
  PRIMARY KEY (episode_id, position)
);
```

`tags` stays a JSON array: display labels with no identity or cross-record relation. Episode
neighbours are derived from `(category, episode_number)`, so there is no stored `previous_episode_id`.

## API

The wire shape is array-based and does not expose the tables:

```json
{
  "lead": "开场的一段话。",
  "researchNote": "公司自报的数据一律按「据称」处理。",
  "credits": "本期旁白：测试音色。",
  "body": "",
  "topics": [
    { "title": "第一个主题", "detail": "展开说明。", "sourceUrls": ["https://example.com/source"] }
  ],
  "mentions": [{ "name": "OpenAI", "description": "训练环境隔离说明。", "url": "https://openai.com/..." }]
}
```

`topics` holds 0-30 entries and `mentions` 0-50. Updating an episode without `topics` or `mentions`
preserves the stored rows; sending `[]` clears them. `GET /api/episodes` remains a light summary and
carries neither collection; the single-episode endpoints return both.

## Write paths

- Studio episode editor and production `Assets` panel: `topics` through a dedicated editor, prose
  through Markdown fields.
- Production snapshots: publication copies the same structure into the episode row and replaces the
  child rows inside one batch, fenced on the snapshot the publication produced.
- Agent API: inherits the schemas, so `production` stage patches and standalone episode writes accept
  the same fields.
- Final approval requires at least three topics plus summary, current cover and current audio.

## Migration record

1. `0025_episode_structure.sql` added the four columns and both tables alongside the legacy
   `show_notes` / `mentions` columns. The deployed worker kept rendering from the legacy column, so
   the schema change was invisible.
2. A one-shot script parsed all thirteen published episodes into the new fields — 121 topics and 274
   mentions — and wrote the same structure into each production record so the next publication keeps
   it. Reads preferred structure and fell back to `show_notes` for anything un-migrated.
3. `0026_drop_legacy_notes.sql` rebuilds `episodes` without `show_notes` and `mentions`, preserving
   every remaining column, the two child tables, the three indexes and `UNIQUE (category, slug)`.
   Rebuilding is required because the `mentions` column was guarded by `CHECK (json_valid(mentions))`,
   which blocks `ALTER TABLE ... DROP COLUMN`; child rows are copied to staging tables first because
   dropping the parent cascades into them.
4. The legacy reading branch, the show-notes outline parser and the read-only studio block were
   removed with the same release.

Pre-migration backups (per-table JSON plus schema and a D1 bookmark) were captured outside the
repository before each write; they are local only and are not part of the release.

## Invariants

- The storage reference scan reads `episode_mentions.url`, `episode_topics.source_urls` and the four
  prose columns. Any new text field that can carry a media URL must be added there too, or cleanup
  can treat referenced media as orphaned.
- RSS descriptions use `summary` and the ordered mention list; keep that composition stable.
- Public pages render `lead`, then topics, then `body`, then the research note and credits, and fall
  back to `summary` only when an episode has no body at all.
