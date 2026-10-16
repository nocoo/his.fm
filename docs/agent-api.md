# Scoped site API

The site API uses explicit bearer-token grants for editorial production and site
management. It is not an infrastructure API, an external publishing service or a
replacement for the resident native coordinator. REST business operations do not
require a station; execution of submitted creative tasks and generated narration
still requires the configured native station.

## Discovery

Start with `GET /api/agent` and follow its links:

- `/api/agent/openapi.json`: OpenAPI 3.1, including controller-derived Zod request
  schemas and each operation's `x-required-scopes`.
- `/api/agent/instructions`: [REST-first onboarding](api-onboarding.md).
- `/.well-known/api-catalog`: RFC 9727 discovery using an RFC 9264 linkset.
- `/llms.txt`: public link index, without private prompts or production content.
- `/api/agent/me`: authenticated identity, token ID, grants and expiry.
- `/api/agent/capabilities`: effective grants, submission actions, limits and
  narration voices; not a universal promise that every action is available.
- `/api/agent/productions/:id/capabilities`: current stage/version, editable
  fields, authorized actions and blocking reasons.

Discovery supports GET, HEAD and OPTIONS. Discovery success does not authenticate
a token. Protected errors include `error`, `code` and `documentation`; a `401`
also carries a Bearer challenge. There are no MCP, A2A or OAuth endpoints.

## Tokens and grants

The owner issues tokens at `/admin/connections`. The form starts with an explicit
read-only preset, supports per-scope changes and requires visible acknowledgement
for high-risk grants, including full control. Presets expand to finite grant
lists; they are not wildcards and cannot authorize future capabilities.

Bearer requests use `Authorization: Bearer <token>` under `/api/agent`. Human
studio requests remain under `/admin/api` with Access/same-origin protections.
Tokens never authenticate a human studio session.

| Method | Agent path | Required grant | Contract |
| --- | --- | --- | --- |
| GET | `/agent-tokens` | `tokens:read` | Metadata and grants, never existing token secrets |
| POST | `/agent-tokens` | `tokens:issue` | `{name,expiresInDays,scopes}`; returns `{token,record}` once |
| DELETE | `/agent-tokens/:id` | `tokens:revoke` | Revoke token and descendant tokens |

The owner can also use these paths under `/admin/api`. Grants must be nonempty,
unique known scope names. Lifetime is 1-365 days. A bearer issuer cannot grant
scopes it lacks or issue a token outliving its own expiry; the request is rejected,
not silently narrowed. A bearer revoker cannot target a token with grants outside
its own. Complete token values appear only in their creation response. Persist
secrets privately, never in browser storage, URLs, logs or source control.

The database stores hashes, prefixes, grants, parentage and timestamps. Unknown,
expired, revoked and legacy unscoped tokens fail closed. Reissue obsolete tokens
and explicitly re-enroll the station; there is no automatic privilege migration.

## Resource operations

All paths in this table are relative to `/api/agent`. Read the OpenAPI contract
for exact request bodies, media types and response projections.

| Resource | Operations | Grants |
| --- | --- | --- |
| Productions | List/read/create/edit/delete, stage actions | `productions:read/write/delete/submit/approve/reopen` |
| Publication records | Read, confirm, correct, withdraw | `publications:read/write/delete` |
| Episode library | List/read/create/edit/delete, featured flag, visibility | `episodes:read/write/delete/publish` |
| Categories | List/read/create/edit/delete | `categories:read/write/delete`; private prompt reads/writes additionally use `prompts:read/write` |
| Channel prompts | GET/PUT `/channel` | `prompts:read/write` |
| Appearance | GET/PUT `/appearance` | `appearance:read/write` |
| AI and narration settings | `/ai-settings`, `/production-settings` | `settings:read/write`; supplied credential replacements/clears use `credentials:write` |
| Bumpers | List/read/upload/rename/delete | `bumpers:read/write/delete` |
| Storage | Cursor scan, immutable upload, object download, safe deletion/cleanup | `storage:read/write/delete` |
| Tasks | Submit/list/read/cancel; explicit all-site administration | `tasks:submit/read/cancel/manage` |
| Native station | Read/enroll `/agent/station`, connect runtime | `runtime:manage/connect` |

Scopes are independent: write does not imply read, approval or publication.
Compound operations require every declared grant. Cover/audio attachment requires
`productions:write` and `storage:write`. Audio generation uses `audio:generate`
and still requires an approved script and an available native executor. Granting
permissions does not bypass business validation, state transitions or costs.
Agent-origin audio/preview requests also require `tasks:manage` and `prompts:read`;
production narration additionally requires `productions:read` for native task
preparation. Human studio flows retain their existing authentication.

No endpoint returns saved provider keys. `GET /ai-settings` reports key presence
and allowlisted settings. `PUT /ai-settings` requires `settings:write` when
`settings` is supplied and `credentials:write` when `credentials` is supplied;
either or both can be sent with the current version fingerprint. A null key
clears the saved value. Without `settings:read`, the response contains only the
new `version`, not the saved configuration. Credential replacements are write-only. AI/narration
configuration is native configuration shared by Local and Prod, not an isolated
per-website D1 setting; do not mistake an environment switch for configuration
isolation. Settings calls can fail while the native station is unavailable.
`GET /production-settings` returns `bumpers: []` without `bumpers:read`, even
when bumper records exist; `settings:read` does not grant bumper metadata.

## Read projections

Production mutation/audio responses without `productions:read` contain only
`{production:{id,version}}`, not the transcript, assets or other private fields.
Episode mutations similarly return only `{episode:{id,version}}` without
`episodes:read`. Bumper upload/update responses return only `{bumper:{id,version}}`
without `bumpers:read`; that grant permits the existing full metadata response.
Write-only grants do not confer read access through response echoes.

Private prompt access is separate from production/category metadata. A production
read does not grant the selected category's prompt, and mutation responses must
preserve the same projection. Category prompt fields and production
`categoryProfile.prompt` require `prompts:read`; production reads still include
selected category metadata. A prompt update without `prompts:read` returns only
the new version. Without `publications:read`, production responses omit publication details
and publication audit events. Do not infer a missing field is an empty stored
value and write it back.

## Production workflow

`draft -> brief_review -> scripting -> script_review -> production -> final_review -> ready`

1. Create/edit a brief, then submit with `productions:submit`.
2. An authorized reviewer approves with `productions:approve`, or sends work
   back with `productions:reopen` and feedback.
3. Edit the transcript in `scripting`, submit it and obtain script approval.
4. In `production`, complete summary/description and upload clean cover/audio or
   request native narration. Submission requires assets for the current script.
5. Submit final assets and obtain final approval before confirming publication.

`productions:approve` does not imply `productions:reopen`. Both `revise_*`
(send back for changes) and `reopen_*` actions require `productions:reopen`;
approval authority alone cannot perform either action family.

A scoped agent may perform approvals only when explicitly granted that authority.
Audit actors remain agents with token identities; the API never impersonates a
human. The resident coordinator's typed production actions remain submission-only
and do not acquire reviewer authority simply because another API token has it.

GET `/channel` and the selected category prompt before each creative task when
authorized. Editorial priority is global prompt, category prompt, episode intent,
then sources. Prompt revisions affect subsequent tasks, not existing approvals;
policy never overrides facts or grants permissions. Keep private principles out
of published output. Use the product task pipeline for editorial work rather than
an alternate development-agent generation path.

Reopening the script invalidates active script-derived audio and final approvals.
Reopening the brief also clears brief approval. Reopening assets preserves the
approved script while clearing final approval. Public snapshots stay unchanged
until an explicit authorized publication operation.

## Assets and publication

Upload actual raster cover bytes (`image/png`, `image/jpeg`, `image/webp`), at most
8 MiB. Sources must be clean originals without text, logos, borders or overlays.
The studio-only finished download composes the independent brand frame. The
server verifies signatures and bounded bytes, not visual content. Each upload
uses an immutable key; arbitrary external asset URLs cannot bypass this path.

`PUT /productions/:id/assets/audio?version=N` attaches a validated mono 24 kHz
PCM16 WAV after script approval for files that fit the Worker request limit
(roughly up to ~90 MiB). For larger narration (up to one hour / ~175 MiB), upload
the WAV out-of-band to the `his-fm` R2 bucket from the Studio machine with the
project `cf` CLI, then bind it:

```sh
cd apps/web
UPLOAD_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
KEY="productions/${PRODUCTION_ID}/audio-${SCRIPT_VERSION}-${UPLOAD_ID}.wav"
cf r2 objects put "$KEY" \
  --bucket-name his-fm \
  --file /path/to/narration.wav \
  --content-type audio/wav \
  --mode production
```

```http
POST /productions/:id/assets/audio/bind
Authorization: Bearer …
Content-Type: application/json

{"version": <current production version>, "key": "<KEY>"}
```

Staging keys `uploads/<uuid>.wav` are also accepted; binding copies them into an
immutable `productions/{id}/audio-<scriptVersion>-<uuid>.wav` key. Direct
production keys must match the current `scriptVersion`. Both paths validate mono
24 kHz PCM16 WAV, duration ≤ 3600 s, and require `productions:write` and
`storage:write`. Native generation remains a separate queued job path. Asset
detachment requires the expected production version and does not destroy
referenced R2 objects or silently rewrite published snapshots.

`POST /productions/:id/publications` records an actual completed publication.
The production must be ready with current final assets/approval. Future timestamps
are rejected. `platform: "site"` publishes the approved snapshot to the public
his.fm episode page and does not require an external URL (`{version,platform,publishedAt}`).
`wechat` and `xiaoyuzhou` still require `{version,platform,url,publishedAt}`; their
URLs must use `mp.weixin.qq.com` or `xiaoyuzhoufm.com` (subdomains accepted). This
records a fact; it never calls either platform's publishing API.

`PATCH /productions/:id/publications/:platform` corrects an existing record;
`DELETE` withdraws it with an expected version. Snapshot changes and publication
records remain atomic. Withdrawing the last record unpublishes the corresponding
site snapshot, not the external platform's post. Published production snapshots
cannot be rewritten through raw episode CRUD; the separate episode featured
operation changes display metadata only.

Storage cleanup must scan every cursor first. Deletion revalidates object versions
and references, protects `images/`, `reference/`, active job prefixes/snapshot
bumpers, and uploads younger than 24 hours. A partial/failed scan is not permission
to clean up. Cleanup does not purge the CDN or compress media.

## Tasks and native execution

`POST /tasks` accepts `{id,text,context}` with `context` a typed `PageContext` or
null. Production context additionally requires `productions:read`. Identity comes
from the authenticated caller, not client-supplied principal fields. Task IDs are
stable; list/read/cancel are limited to the bearer caller's own tasks unless
`tasks:manage` additionally grants all-site task administration.

Agent-origin submission requires `tasks:submit`, `tasks:manage` and `prompts:read`.
The native coordinator and reusable executors retain shared task history; they
are not isolated by token or caller. `tasks:manage` explicitly authorizes access
to that shared history, including material supplied by other tasks. A
`tasks:submit`-only token cannot enter this shared execution path. Fine-grained
REST operations remain available independently; this is a conservative trust
boundary, not low-scope session isolation or an OS sandbox.

Task effects are bounded by both the execution token and originator's current
grants. Revoked/expired originators cannot continue through a more privileged
coordinator. Accepted/queued is not executed or successful: inspect task state,
artifacts and exact website receipts. Without an online station, a queued task
is not an alternate server-side generation runtime.
Every task read carries its original command ID and is authorized by the server
against current originator/executor grants. Compaction fetches the shared prompt
only after every potentially running/restoring command is authorized for the
same prompt version. A rejected or revoked concurrent task can therefore block
compaction until that task is stopped; there is no privileged-token or cached
prompt fallback.

Native execution requires explicit enrollment at `/agent/station`, then
`GET /runtime/connect` with Bearer and `X-Hisfm-Station`. Never put tokens in a
WebSocket URL. Typed schemas live in `@his-fm/contracts`; operations use stable
IDs and expected versions. `GET /runtime/receipts/:id` can return `202` when the
outcome is still unknown. Speech transport is job-scoped and is not a general
R2 upload or credential endpoint. See [native runtime](native-agent.md).

## Versions and failures

Existing-record writes require the version just read (body or query, per
OpenAPI). Settings use a configuration fingerprint; storage uses object versions.
Successful mutations advance the version. On `409`, read the latest state and
reassess rather than replaying a stale full object.

Typical responses: `400` invalid input, `401` invalid authentication, `403` missing
grants, `404` missing resource, `409` business/version conflict, `413` body too
large, `415` unsupported media, `503` unavailable native execution. The JSON
limit is 750,000 bytes and a production retains at most 200 audit events; history
is not silently discarded to allow more changes.
