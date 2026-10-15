# Editorial categories

Categories have stable server-assigned IDs, names, a curated Lucide icon and a Basalt tag color. The studio manages metadata at `/admin/categories[/:id]`; private Markdown guidance is also available through the central Prompts page.

## API and versions

| Operation | Required scope |
| --- | --- |
| `GET /api/categories` | Public ID/name/icon/color only |
| `GET /api/agent/categories[/:id]` | `categories:read`; prompt additionally needs `prompts:read` |
| `POST /api/agent/categories` | `categories:write`; setting a prompt additionally needs `prompts:write` |
| `PUT /api/agent/categories/:id` | `categories:write`; changing a prompt additionally needs `prompts:write` |
| `DELETE /api/agent/categories/:id?version=N` | `categories:delete` |

The same controllers serve authenticated owner routes under `/admin/api`. Updates accept `version` and partial metadata/prompt; omitted fields are preserved. Names allow 80 characters and prompts 30,000; shared validators bound icons/colors. Prompt fields never appear in public responses.

Referenced categories cannot be deleted. Episode foreign keys and production category fences protect associations during writes. All updates/deletions check the optimistic version; concurrent changes return 409. The editor retains drafts and safe previews with explicit saving and conflict resolution.

## Editorial policy

Priority is **global prompt -> category prompt -> episode intent -> sources**. The private production prompt endpoint includes current category guidance. Production detail projects `categoryProfile` separately from stored production content, with its prompt omitted unless authorized.

Changing a production's category reopens its brief when required by the state machine. Editing category guidance alone does not rewrite existing productions, approvals or publication snapshots. External clients should reread guidance before new work. Prompt text never grants API authority or changes factual truth.
