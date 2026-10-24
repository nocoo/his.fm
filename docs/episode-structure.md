# Episode structure: schema plan

Status: proposal. No migration in this document is applied yet.

## Purpose

Episode bodies are stored as one free-form Markdown blob (`episodes.show_notes`) plus a JSON array
(`episodes.mentions`). The public site therefore has to guess structure from prose: the episode
outline currently parses bullet lists out of `show_notes`, which breaks whenever an episode uses a
different heading or list style. Auditing the thirteen published episodes shows three different
generations of formatting, with 本期听点 / 说明 / 研究边界 / 来源 appearing variously as headings,
inline labels and plain paragraphs.

This plan replaces guesswork with explicit fields and tables, adds them alongside the current
columns, and removes the legacy columns only after the catalogue has been backfilled and verified.

Non-goals: changing episode identity (slug, number, category), publication and approval semantics,
media handling, SEO resolution, or the RSS/JSON-LD output shapes.

## Current audit

### Storage

```sql
-- episodes (live columns relevant here)
summary        TEXT NOT NULL     -- catalogue card summary, 100-260 characters
transcript     TEXT NOT NULL     -- private, never public
show_notes     TEXT NOT NULL     -- the whole episode body as Markdown
tags           TEXT NOT NULL     -- JSON array of display labels
mentions       TEXT NOT NULL     -- JSON array of {name, description, url?}
```

All 13 published episodes are production snapshots (`source_production_id` is set), so their
content is written only through the production workflow: patch the production, then record or
correct a publication, which upserts the snapshot in the same batch.

`foreign_keys` is enabled in D1 (`PRAGMA foreign_keys = 1`).

### Structure actually used by the catalogue

| Generation | Episodes | Shape |
| --- | --- | --- |
| Older | learning 01-03 | lead paragraph, `## 本期听点` ordered list of `**标题**：细节` with a nested `来源：<url>、<url>` line per item, `## 说明`, `## 音乐致谢` |
| Middle | learning 04-06, manager-notes 02 | `# 标题`, duration/voice line, lead paragraph, `## 本期听点` list, `## 说明`, `## 音乐致谢` |
| Newer | learning 07-10 | lead paragraph, inline `本期听点：` bullet list, `研究边界：`, `来源：`, `上一期：`, narration note, `## 音乐致谢` |
| Notes | manager-notes 01 | `## 本期讨论` bullet list, no lead |
| Notes | manager-notes 03 | prose lead followed by a bullet list, no headings |

Five episodes have no list at all; three carry per-topic source URLs that are absent from
`mentions`; `mentions` itself always holds the flattened source list (1-50 items, up to 8 KB).

### Consumers that read the legacy columns today

| Consumer | Reads | Impact of the split |
| --- | --- | --- |
| `worker/episodes.ts` | every column | row mapping, insert/update, projections |
| `worker/production.ts` | writes `show_notes`, `mentions` on snapshot upsert | also writes the new child rows |
| `worker/public-html.ts` | renders SSR payload | detail payload grows by the structured fields |
| `worker/feed.ts` | `summary`, `mentions` | `mentions` becomes a join |
| `worker/storage.ts` | `show_notes`, `mentions` for R2 reference scanning | **must scan the new tables, or cleanup can delete referenced media** |
| `src/shared/seo-jsonld.ts` | `mentions` | unchanged shape, new source |
| `src/public/PublicRoutes.tsx` | `show_notes` render, outline parser | structured render with legacy fallback |
| `src/admin/EpisodeEditor.tsx` | `showNotes` textarea | replaced by structure editors |
| `src/admin/production/Assets.tsx` | `description` | gains structure fields |
| `worker/agent-contract.ts` | derives from `episodeInputSchema` | extends automatically |
| `docs/api-onboarding.md` | documents `mentions` on `/api/episodes` | already stale after the payload split; fix together |

## Target model

### New columns on `episodes`

Single-valued prose blocks, all `NOT NULL DEFAULT ''` so existing rows stay valid:

```sql
ALTER TABLE episodes ADD COLUMN lead TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN research_note TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN credits TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN body TEXT NOT NULL DEFAULT '';
```

- `lead`: opening paragraph(s) that set up the episode; replaces the pre-heading prose.
- `research_note`: the 说明 / 研究边界 block: methodology, “据称” boundaries, what the episode does
  not claim.
- `credits`: narration voice, music attribution, licence notes.
- `body`: any remaining Markdown that has no dedicated field. Kept so the migration cannot lose
  material, and so an episode may carry extra sections without new columns.

Each of these renders through the existing `ReadingText` sanitiser, so links and Markdown behave as
they do today.

### New table `episode_topics`

```sql
CREATE TABLE episode_topics (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  source_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_urls)),
  PRIMARY KEY (episode_id, position)
);
CREATE INDEX episode_topics_episode ON episode_topics(episode_id, position);
```

`source_urls` is a JSON array of `http`/`https` URLs validated in the application layer (the older
episodes cite sources per topic). It is deliberately not a third table: nothing queries individual
source URLs, and the migration cannot reliably align them with `episode_mentions` rows.

### New table `episode_mentions`

```sql
CREATE TABLE episode_mentions (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  url TEXT CHECK (url IS NULL OR (length(url) <= 2048 AND url LIKE 'http%')),
  PRIMARY KEY (episode_id, position)
);
CREATE INDEX episode_mentions_episode ON episode_mentions(episode_id, position);
```

Ordering is explicit through `position`; the API keeps exposing a plain array, so clients and the
migration bot never see the table.

### Deliberately unchanged

- `tags` stays a JSON array: display labels, no identity, no cross-record relations.
- `seo`, `rss_guid`, `write_id`, `version`, numbering and claims tables are untouched.
- No `previous_episode_id`: neighbours are derived from `(category, episode_number)`, which cannot
  disagree with the catalogue. Cross-episode prose references stay inside `lead`/`body`.

## API contract

The wire shape stays array-based; only the projection changes.

```json
{
  "version": 7,
  "lead": "agent 手里有了终端、浏览器……",
  "researchNote": "公司和项目自报的数字一律按「据称」处理。",
  "credits": "本期旁白采用 AI 合成……",
  "body": "",
  "topics": [
    {
      "title": "实验室怎样关住训练中的模型",
      "detail": "OpenAI 公开训练环境的隔离做法……",
      "sourceUrls": ["https://openai.com/index/securing-our-frontier-model-training-environment/"]
    }
  ],
  "mentions": [
    { "name": "OpenAI", "description": "训练环境隔离说明。", "url": "https://openai.com/..." }
  ]
}
```

Rules:

- `topics` is ordered, 1-12 entries; `mentions` stays ordered, 0-50 entries.
- Omitting `topics`/`mentions` on PUT preserves the stored rows; sending `[]` clears them. This
  matches the existing `seo` omit-versus-clear convention.
- `lead`, `researchNote`, `credits`, `body` are optional strings; omitted means “not supplied”.
- `GET /api/episodes` (catalogue) stays a light summary and gains nothing: topic titles are not
  needed by cards today. `GET /api/episodes/{category}/{slug}` returns the structured episode.
- `PublicEpisode.showNotes` disappears only in the removal release; until then it is still returned
  for un-migrated rows.

## Write paths

1. **Standalone episodes** — `PUT /admin/api/episodes/{id}`: the episode row and the two child
   tables are rewritten in one `db.batch`, replacing child rows inside the same transaction as the
   version bump.
2. **Production snapshots** — `Production` gains `lead`, `researchNote`, `credits`, `topics`;
   `description` remains the legacy body until removal. The publication upsert writes the episode
   row, deletes and re-inserts `episode_topics` / `episode_mentions`, and keeps its existing
   version/approval guards.
3. **Agent API** — inherits the same schemas. `agentEditableFields.production` gains the new field
   names so a client can supply structure during the `production` stage.
4. **Editorial gate** — `requireFinalAssets` currently demands a non-empty `description`; it becomes
   “`summary` plus at least three topics, or a non-empty `description`” until the removal release.

## Transitional studio behaviour

Between step 2 and step 4 two representations exist, so the studio must not offer two writable
bodies at once:

- `EpisodeEditor` and the production `Assets` panel expose the structure editors (lead, topics,
  research note, credits, body) as the only writable episode body.
- The legacy `show_notes` value is shown read-only with a “尚未迁移 / migrating” badge, so an editor
  can see the original text without overwriting the structure with an older save.
- Saving writes structure only; the legacy column keeps whatever it held until step 4, which makes
  every backfill reversible by clearing the new fields.

## Migration runbook

### Step 1 — schema only

`0025_episode_structure.sql`: the four `ALTER TABLE` statements and the two `CREATE TABLE`s above.
No data is read or rewritten. Deploying this alone changes nothing observable.

### Step 2 — dual-read, dual-write release

- Read resolution: `structured` when `lead` or `research_note` or `credits` or `body` is non-empty,
  or `topics` has rows; otherwise `legacy`, which renders `show_notes` exactly as today.
- `outlineFromShowNotes` survives **only** for legacy rows and is deleted in step 4.
- The storage reference scan gains `episode_mentions.url`, `episode_topics.source_urls` and the four
  new text columns **before** any backfill runs. This is the one change that must not be deferred:
  cleanup would otherwise treat referenced media as unreferenced.
- A read-only progress endpoint `GET /admin/api/episodes/structure` lists, per episode, whether it
  is structured, its topic count, mention count, and the digest of the legacy `show_notes` that was
  present when the structure was written.

### Step 3 — bot backfill

Two possible channels; this is the decision that needs an explicit answer before step 3 starts.

**M1 — through the editorial workflow.** The bot patches each production (`lead`, `topics`,
`researchNote`, `credits`), which revokes final approval, then a human re-approves and a publication
correction rewrites the snapshot. Safest, but 13 × (patch → approve → correct) and it churns
approval history.

**M2 — temporary backfill endpoint.** `PUT /admin/api/productions/{id}/structure` accepts only the
four prose fields plus `topics`, requires both `productions:write` and `episodes:write`, and:

- refuses to run when the stored `show_notes` digest differs from the digest the bot reports
  (guards against overwriting a human edit made after the bot read the episode);
- never touches title, summary, cover, audio, category, tags, SEO, approvals, publications or
  `published_at`;
- writes the production fields and the linked snapshot's structure columns and child rows in one
  batch, appends a `backfill_structure` production event, and bumps the snapshot `version`;
- leaves `show_notes` and `mentions` untouched, so the old rendering path still works and the whole
  step is reversible by clearing the new fields;
- is deleted in step 4, together with the scope it uses.

M2 keeps the published text identical (the bot copies, it does not rewrite) while avoiding a
fabricated approval cycle. It does introduce a privileged write that bypasses approval, so it needs
the owner's explicit acceptance and an audit trail.

Backfill order: learning 07-10 first (cleanest shape), then 01-06, then manager-notes. Verify after
each batch that the structured render and the legacy render produce the same visible text, and that
`feed.xml` bytes are unchanged.

### Step 4 — removal

`0026_drop_legacy_notes.sql` plus the code release that stops reading them.

Preconditions, all checked by `GET /admin/api/episodes/structure`:

- every published episode is `structured` with at least one topic;
- every production snapshot and production record has the same structure;
- no row still depends on `outlineFromShowNotes` for its detail outline.

The drop itself needs a table rebuild, not `ALTER TABLE ... DROP COLUMN`: SQLite refuses to drop a
column that a `CHECK` constraint references, and `mentions` carries
`CHECK (json_valid(mentions))`. The rebuild follows the documented twelve-step procedure, preserving
`episodes_public`, `episodes_production`, `episodes_category_number`, `rss_guid`, `write_id` and the
`UNIQUE (category, slug)` constraint, then verifies `PRAGMA foreign_key_check`, row counts and the
constraint/index list before the release is published.

After the rebuild, delete: the legacy columns and their mapping, the structured/legacy branch, the
outline parser and its tests, the M2 endpoint, and the stale `mentions` wording in
`docs/api-onboarding.md`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Published text drifts during backfill | Bot copies, never rewrites; legacy columns remain until step 4; per-batch textual diff |
| A human edit lands between bot read and write | `show_notes` digest guard in M2; M1 has no such race |
| Storage cleanup deletes referenced media | Reference scan extended **in step 2, before any backfill** |
| RSS/JSON-LD output changes | Feed keeps `summary` + `mentions` semantics; compare `feed.xml` bytes per batch |
| Table rebuild in step 4 breaks constraints or indexes | Rebuild script re-creates indexes explicitly and runs `foreign_key_check` plus constraint assertions |
| Detail payload grows | `topics` + `body` land on the single-episode endpoint only; catalogue stays lean |
| Bot writes malformed prose into live pages | Zod validation (`position`, lengths, URL scheme) plus a preview endpoint that renders the structure without saving |

## Open decisions

1. `topics` as a table (`episode_topics`) rather than a JSON column — recommended, so ordering and
   per-topic sources are queryable and validated.
2. `mentions` moved to `episode_mentions` while keeping the array-shaped API — recommended.
3. `body` column kept as the catch-all for prose without a dedicated field — recommended.
4. Migration channel: M1 approved workflow or M2 temporary backfill endpoint — needs an explicit
   choice, because M2 changes what "published content can only change through approval" means
   during the migration window.
5. `tags` stays JSON and no `previous_episode_id` — recommended.
6. The transitional outline parser stays until step 4 — recommended, so no episode loses its
   outline mid-migration.
