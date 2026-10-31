# Prompt slots

`/admin/channel` manages channel and category guidance as independent slot tables. Select a level, edit Markdown and explicitly save the whole table. Add, delete, enable, change merge mode and move up/down in a local draft; **Save all prompts** performs one versioned PUT. Visited editors retain drafts and undo. Category metadata remains at `/admin/categories` and is separate from slot tables.

## Slot model

A slot has a stable `id`, `title`, Markdown `body`, integer `order`, `enabled`, `mode` (`append` or `override`), server-owned `version`, `updatedAt` and `updatedBy`. Initial IDs are `positioning`, `editor`, `collector`, `voice`, `cover`, `producer`, `brand`, `skills`; they may be deleted, and other IDs added. `skills` accepts one skill name per line (letters, digits, dots, underscores, slashes and hyphens), never instructions. Empty bodies are allowed. Write limits: 64 slots, 120-character titles, 120,000 characters per body, 400,000 total body characters; the existing 750,000-byte JSON request cap also applies.

Each level returns `{version, initialized, slots}`. An never-saved table has version `0`, `initialized: false` and an empty `slots` array, but the studio and API treat it as an editable empty collection—the first successful PUT or POST initializes storage. Slot mutation requests always carry the **table version**, not the individual slot version. Every successful write increments the table version; changed slots increment their own versions and record the authenticated actor. Unchanged slots retain their audit fields. Category metadata edits do not change its slot-table version. Stale writes return 409 and never partially save. Rename preserves category slots and their versions.

## HTTP surface

| Route | Purpose | Grants |
| --- | --- | --- |
| `GET/PUT/POST /channel/prompt-slots` | Read or replace/add the channel table | `prompts:read` / `prompts:write` |
| `PATCH/DELETE /channel/prompt-slots/{slotId}` | Edit or remove one channel slot | `prompts:write` |
| Same paths under `/categories/{id}/prompt-slots` | Per-category local table | same |
| `GET …?slot=editor,collector` | Merged enabled roles plus Markdown `body` | `prompts:read` |

Category metadata routes reject a supplied legacy `prompt` field with 400. `PUT /channel` (whole bundle) returns 405; use prompt-slots. `GET /channel` returns editorial `priority` only.

## Merge and production reads

The channel route reads channel slots only. A category role query merges channel and that category by stable ID, then filters selected IDs. Only enabled slots participate. `append` joins channel body and category body with two newlines; `override` uses only the category body. A disabled category slot does **not** suppress the enabled channel slot; an enabled empty `override` deliberately clears it. Category metadata (`title`, `order`, `mode`) wins when it participates. Results sort by ascending `order`, then ID. Unknown selected IDs are omitted. Uninitialized levels contribute no slots.

Role responses include a Markdown `body` composed as `## <title>`, a blank line, then the exact body, with two newlines between nonempty enabled slots. Whole-table reads remain local, never merged. Production prompt reads always merge enabled channel and category slots before episode intent and materials.

Prompt edits never grant permissions, do not rewrite factual truth, and do not change production versions, review state or publication snapshots.

## Schema history

Migration `0023_prompt_slots.sql` added slot columns. Migration `0027_drop_legacy_prompts.sql` drops legacy whole-prompt columns in place (`channel_profile.content`, `channel_profile.prompts`, `categories.prompt`) and removes the `prompt_slot_backups` table (no `categories` table rebuild, so episode and alias foreign keys stay valid). Deploy applies D1 migrations before the Worker update (`apps/web` deploy script); the release Worker must not reference dropped columns.
