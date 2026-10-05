# Editorial categories

The existing `category` field identifies a managed editorial category. `/admin/categories` belongs to the studio navigation group; `/admin/categories/new` creates a category, and `/admin/categories/:id` edits it. Metadata consists of a name, a deliberately small Lucide icon catalog and a Basalt tag color. Private Markdown prompts use the same CodeMirror editor as the global channel prompt.

## Storage and mutation

Migration `0010_categories.sql` seeds the four existing IDs/names with empty prompts and rebuilds the episode table without the old four-value CHECK constraint. Existing episode rows, indexes and production associations are preserved. The category foreign key protects episode references; the production JSON category reference is checked in the same D1 batch as writes. No generated editorial content is seeded and no published episode is rewritten.

- `GET /api/categories`: allowlisted ID, name, icon and color only. It never returns prompt bodies, authors or revisions.
- `GET /admin/api/categories`: selectable metadata.
- `POST /admin/api/categories`: owner-only creation; the server assigns the stable ID.
- `GET /admin/api/categories/:id`: private metadata, prompt and version.
- `PUT /admin/api/categories/:id`: complete owner update with the current optimistic version.
- `DELETE /admin/api/categories/:id?version=N`: owner-only deletion if unchanged and not referenced by any production or episode.
- `GET /api/agent/categories[/:id]`: authenticated read-only discovery and prompt access. Machine writes are forbidden.

Authenticated writes retain the existing Access/local-session and same-origin checks. Names are bounded to 80 characters and prompts to 30,000 characters; icon/color values come from shared strict validators. Empty prompts add no category guidance. The editor retains per-environment tab drafts, safe preview/undo and explicit conflict resolution. Save is always explicit.

## Prompt order and freshness

Editorial order is **global channel prompt -> selected category prompt -> episode intent -> sources**. Both `/api/agent/productions/:id/prompts` and native writer/reviewer assignments include current private category content after the global prompt. The private production read carries `categoryProfile` separately from persisted production data. Public episodes never contain that profile.

The coordinator reads the latest profiles for each creative assignment, and conversation reuse requires matching global and category identities/revisions. A category changed after an explicit read or delegation prevents canonical writes until the coordinator rereads and reviews it. Changing a production's selected category is a brief change and reopens the corresponding approvals; updating category style alone does not rewrite productions, media or approvals.

Editorial prompts do not grant tools, permissions, human approvals or publication authority. Conflicts with the global prompt require owner resolution rather than silently changing factual claims or the intended subject.

## Local acceptance

On 2026-10-05, a temporary category required an exact opening and closing sentence. The real coordinator read global profile v47 and category v1, delegated a writer and preserved a 128-character Markdown artifact satisfying both sentences. The artifact was read back and hashed (`b76ce77722877a6222c3b5cccd147cd578b37af794fe6229e7295c4031622bc3`); the temporary production stayed at version 1 with no manuscript, approvals or publication changes.

Full coordinator acceptance did not complete: repeated Pi Durable compaction attempts hit the summary token limit, and the root task eventually timed out. This establishes real category injection and writer output, not a successful end-to-end command. The temporary records were deleted after the command reached its failed state; task/artifact evidence remains locally preserved. Compaction recovery remains a separate runtime issue, not a reason to bypass the product agent or mark the failed command complete.
