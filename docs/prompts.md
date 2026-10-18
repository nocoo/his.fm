# Private prompt slots

`/admin/channel` manages channel and category guidance as independent slot tables. Select a level, edit Markdown and explicitly save the whole table. Add, delete, enable, change merge mode and move up/down in a local draft; **Save all prompts** performs one versioned PUT. Visited editors retain drafts and undo. Category metadata remains at `/admin/categories` and never writes legacy prompt text.

## Contract

A slot has a stable `id`, `title`, Markdown `body`, integer `order`, `enabled`, `mode` (`append` or `override`), server-owned `version`, `updatedAt` and `updatedBy`. Initial IDs are `positioning`, `editor`, `collector`, `voice`, `cover`, `producer`, `brand`, `skills`; they may be deleted, and other IDs added. `skills` accepts one skill name per line (letters, digits, dots, underscores, slashes and hyphens), never instructions. Empty bodies are allowed. Write limits: 64 slots, 120-character titles, 120,000 characters per body, 400,000 total body characters; the existing 750,000-byte JSON request cap also applies. Synthesized role bodies and read-only migration previews preserve their full text without the individual write-body limit; an oversized preview remains readable even when explicit apply would reject it.

Each level returns `{version, initialized, slots}`. Before explicit migration it has version `0`, `initialized:false` and no active slots. Slot mutation requests always carry the **table version**, not the individual slot version. Every successful write increments the table version; changed slots increment their own versions and record the authenticated actor. Unchanged slots retain their audit fields. Category metadata edits do not change its slot-table version. A slot write also increments the parent compatibility version. Stale writes return 409 and never partially save. Rename preserves category slots and their versions; delete retains migration backups.

Paths below are relative to `/api/agent`; owner sessions use identical controllers under `/admin/api`.

| Path | Method / input | Required scope |
| --- | --- | --- |
| `/channel/prompt-slots` | GET table; PUT `{version,slots}`; POST `{version,...slot}` | GET `prompts:read`; writes `prompts:write` |
| `/categories/{id}/prompt-slots` | Same table operations, independent of category metadata scopes | Same |
| Either table + `/{slotId}` | PATCH `{version,body?,title?,order?,enabled?,mode?}`; DELETE `?version=N` | `prompts:write` |
| Either table + `?slot=editor,collector` | GET merged enabled slots, `body` Markdown and `versions` for channel/category | `prompts:read` |
| Either table + `/migration/dry-run` | GET proposed slots, `unmappedHeadings`, `version`, `legacyVersion`, `initialized` | `prompts:read` |
| Either table + `/migration/apply` | POST `{version,legacyVersion}` from reviewed dry-run | `prompts:write` |

Writes without `prompts:read` return only `{version}`. Read permissions do not imply write permissions. The browser saves via whole-table PUT; external clients may use individual CRUD routes. No endpoint grants approval, publishing or spending authority.

## Merge semantics

The channel route reads channel slots only. A category role query merges channel and that category by stable ID, then filters selected IDs. Only enabled slots participate. `append` joins channel body and category body with two newlines; `override` uses only the category body. A disabled category slot does **not** suppress the enabled channel slot; an enabled empty `override` deliberately clears it. Category metadata (`title`, `order`, `mode`) wins when it participates. Results sort by ascending `order`, then ID; query ID order is not output order. Unknown selected IDs are omitted. Both levels must be initialized for merged category reads; otherwise 409 prevents incomplete guidance.

Role responses include a Markdown `body` composed as `## <title>`, a blank line, then the exact body, with two newlines between nonempty enabled slots. Whole-table reads remain local, never merged. Production prompt reads use merged slots once both levels are initialized; until then they retain the transitional whole-prompt composition.

Priority remains **channel -> category -> episode intent -> sources**. Merge mode specifies text composition, not authority to override channel policy, facts or permissions. Conflicts require owner judgment. Edits never rewrite existing productions, approvals or publication snapshots.

## Explicit migration

Schema migration `0023_prompt_slots.sql` adds storage and `prompt_slot_backups` only. It does not split, copy or activate editorial data at deployment. Production prompt bodies are not repository fixtures. The runtime dry-run reads current D1 rows, including the actual `learning` / `manager-notes` versions (v11 at planning time); it never assumes that version remains 11 and performs no DB writes. A fresh environment previews Worker-only channel defaults without persisting them.

1. GET each level's `/migration/dry-run` using `prompts:read`.
2. Review proposed bodies and every unmapped heading. Original category preambles and unknown sections remain in `positioning`; no text is discarded. Only actual `##` role headings outside fences split sections. Explicit category aliases match the full heading after removing whitespace for comparison only; original Markdown remains unchanged. Learning's `收集信息`, `②类时间口径`, `②类（社区新鲜事 / 极客新闻）时间口径` and `素材量与甄别分工` go to `collector`; `栏目：慢慢学会 · 每日手冲` goes to `positioning`. For both learning and manager-notes, `声音生成` goes to `voice`, `通用 skill` to `skills` and `栏目定位` to `positioning`.
3. Separately authorize and POST `/migration/apply` with the reviewed `version` and `legacyVersion`, using `prompts:write`. The transaction fences the current legacy version, records original values/versions/audit in `prompt_slot_backups`, and initializes all slots atomically. A stale snapshot returns 409: review again.
4. Repeating apply on an initialized level is a no-op even after later edits; it returns current state, never overwrites slots or adds a backup. Missing categories return 404. Initialization is required before normal CRUD.

Channel `content` moves unchanged into `positioning`. Legacy named bodies are preserved in matching roles: coordinator/executor and remaining workflow/tool templates -> producer; reviewer/script/description -> editor; brief/boundary -> collector; speech/voiceComparison/narration -> voice; cover -> cover; editorial -> positioning. Migration labels appended legacy keys but does not rewrite their bodies or treat retired tooling prose as executable site features.

Valid category skills sections retain the entire original section in `positioning` and copy only skill names into `skills`; this deliberate duplication preserves the original Markdown block. Invalid skill prose remains only in positioning and is reported for human correction. The dry-run is the evidence for a real dataset: synthetic test success does not prove all live headings were recognized.

## Deprecation

`channel.content`, all 17 `channel.prompts.*` fields, and `category.prompt` remain readable but are **read-only**. `PUT /channel` returns 405. Category create/update rejects supplied legacy `prompt`; use slot endpoints instead. Before apply, reads return stored legacy values. After apply, channel content and every old named field synthesize enabled channel slots in order; category prompt synthesizes enabled local category slots. Empty tables produce empty text. Legacy SQL values and immutable backups are not overwritten by slot edits.

New clients must use prompt slots now. Compatibility reads remain through the consumer transition; removing them requires a separately announced cutover after all consumers are verified. There is no automatic removal date or second writable model. Private prompt bodies never enter public discovery, public responses or browser default bundles.
