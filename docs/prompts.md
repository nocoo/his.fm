# Private prompt catalogue

`/admin/channel` centralizes editorial policy, saved workflow templates, category guidance and narration. `?prompt=<key>` selects one Markdown editor; visited editors retain drafts and undo. Category metadata remains under `/admin/categories`, with prompt editing at `?prompt=category:<id>`.

## Data and consumers

Global `content` and the complete named prompt bundle share D1 `channel_profile.version`. The bundle contains:

`coordinator`, `executor`, `reviewer`, `speech`, `voiceComparison`, `capabilities`, `network`, `decisionPlan`, `decisionThinking`, `compaction`, `editorial`, `boundary`, `brief`, `script`, `cover`, `description`, `narration`.

The original 16 saved keys and bodies are retained as editable templates for external clients. They do not start executors, voice comparisons, compaction or generation inside the website. `narration` is ordinary D1 prompt text, not a provider setting. New defaults live in Worker-only `worker/prompt-defaults.ts`; shared contracts expose labels/limits/validators, never default bodies to the browser.

Migration 0015 appends missing narration and increments the channel version. It does not overwrite existing global or named prompt text and does not read private local configuration. Existing custom narration already stored in D1 remains unchanged.

## API and editing

- `GET /api/agent/channel` requires `prompts:read`.
- `PUT /api/agent/channel` requires `prompts:write`, current `version`, and `content`, `prompts`, or both. If supplied, `prompts` must contain every known key and no unknown keys.
- Write-only callers receive `{version}`; callers with read receive the channel and editorial priority.
- `GET /api/agent/productions/:id/prompts` requires `productions:read` plus `prompts:read` and composes brief/script/cover/description guidance with the current production and category.

Global content allows 30,000 characters. Named prompts allow 12,000, except decision questions (1,500) and voice-comparison style (2,000). These are text limits, not an executable model contract.

The UI saves only the selected editor: it first reads the latest bundle, preserves other keys and presents conflicts for concurrent edits. A race still returns 409. Empty/oversized drafts remain available for correction. Category prompt edits retain their independent category version and preserve omitted metadata. Save is always explicit.

## Editorial boundary

Priority is **global prompt -> selected category prompt -> episode intent -> sources**. External clients read current guidance before creative work. Updating prompts does not implicitly rewrite productions or revoke approvals. Changing a production's selected category is a brief change and follows the review state machine.

Prompt text cannot grant API scopes, approval, publication or spending authority, change validators, or override facts. Public discovery and frontend bundles contain no private prompt bodies. Existing stored instructions that refer to retired tools remain user data; owners may revise them explicitly rather than the application silently rewriting them.
