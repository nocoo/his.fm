# Editorial categories

Categories have stable server-assigned IDs, names, a curated Lucide icon and a Basalt tag color. The studio manages metadata at `/admin/categories[/:id]`; private Markdown guidance is also available through the central Prompts page.

Default seed IDs for new environments are `manager-notes`, `learning`, `life` and `conversations`. Owners may rename IDs and display names through the studio or Agent API without a code release.

| ID (seed default) | Public name (seed default) | Editorial focus |
| --- | --- | --- |
| `manager-notes` | 主理人手札 | Team and personal AI transformation (non-daily column) |
| `learning` | 每日手冲 | Slow-learning daily series (coffee metaphor; not realtime news) |
| `life` | 生活留白 | Life outside the screen |
| `conversations` | 一起聊聊 | Conversation-led episodes |

Published episode slugs are not renamed with display titles; the daily learning series keeps `daily-news-*` URLs for compatibility.

## API and versions

| Operation | Required scope |
| --- | --- |
| `GET /api/categories` | Public ID/name/icon/color only |
| `GET /api/agent/categories[/:id]` | `categories:read`; prompt additionally needs `prompts:read` |
| `POST /api/agent/categories` | `categories:write`; legacy prompt input is rejected |
| `PUT /api/agent/categories/:id` | `categories:write`; legacy prompt input is rejected |
| `/api/agent/categories/:id/prompt-slots` | GET `prompts:read`; PUT/POST and child PATCH/DELETE `prompts:write`; independent collection version |
| `DELETE /api/agent/categories/:id?version=N` | `categories:delete` |

The same controllers serve authenticated owner routes under `/admin/api`. Updates accept `version` and partial metadata; omitted fields are preserved. Optional `nextId` on `PUT` atomically renames the category ID, preserves prompt slots/versions and updates `episodes.category` plus `productions.data.category` references. Names allow 80 characters; shared validators bound icons/colors. Prompt fields never appear in public responses.

Whole `prompt` is a read-only transitional projection: stored legacy text until explicit migration, then enabled local slots concatenated in order. Slot reads/writes require only prompt grants, not metadata grants. The central Prompts page edits local slot drafts with explicit atomic table saves. See [prompt slots](prompts.md) for runtime dry-run/apply paths, backup, merge semantics and deprecation plan. Category metadata changes do not change the slot-table version; a prompt slot write also updates the parent compatibility version.

Referenced categories cannot be deleted. Episode foreign keys and production category fences protect associations during writes. All updates/deletions check the optimistic version; concurrent changes return 409. The editor retains drafts and safe previews with explicit saving and conflict resolution.

## Editorial policy

Priority is **global prompt -> category prompt -> episode intent -> sources**. The private production prompt endpoint includes current category guidance. Production detail projects `categoryProfile` separately from stored production content, with its prompt omitted unless authorized.

Changing a production's category reopens its brief when required by the state machine. Editing category guidance alone does not rewrite existing productions, approvals or publication snapshots. External clients should reread guidance before new work. Prompt text never grants API authority or changes factual truth.

## Renaming without engineering

1. Open **设置 → 栏目管理** (`/admin/categories/:id`) or call `PUT /api/agent/categories/:id` with `categories:write`.
2. Send the current `version`, the new display `name` if needed, and optional `nextId` (lowercase letters, digits and hyphens).
3. Save. The server bumps the category version, rewrites episode and production foreign keys, and leaves prompts/content intact.
4. Update display names alone with the same `PUT` without `nextId`. Episode titles, bumper copy and manuscript text are edited through **节目** / **制作** / **贴片** APIs or their admin screens, not category metadata.
