# Agent production API

The production API lets a local agent research and prepare an episode while preserving human review of the brief, script and finished assets. It does not publish to external platforms or grant an agent permission to approve its own work.

## Discovery and onboarding

Start at `GET /api/agent` (with or without a trailing slash). It returns a public manifest with the actual OpenAPI, instruction, authentication and resource links. Read [native agent onboarding](native-agent.md), served directly at `/api/agent/instructions`.

- `/.well-known/api-catalog`: RFC 9727 catalog using RFC 9264 `application/linkset+json`.
- `/api/agent/openapi.json`: OpenAPI 3.1 request/response schemas, methods, bearer security and operation IDs. Request schemas derive from the same Zod validators as the controllers.
- `/llms.txt`: public agent-readable link index; no production content or internal editorial policy.
- `GET /api/agent/me`: authenticated identity check. A successful public discovery request does not validate a token.
- `GET /api/agent/capabilities`: authenticated permissions, limits and narration defaults/voices.
- `GET /api/agent/productions/:id/capabilities`: latest version, editable fields, executable submissions and blocking reasons. Submission eligibility uses the same state machine as mutations.

Discovery supports GET, HEAD and OPTIONS. Agent API responses carry `Link` headers for service discovery and documentation. Errors retain `error` and add `code` and `documentation`; 401 responses include a Bearer challenge. No MCP, A2A or OAuth endpoints are advertised.

## Global prompt

Global prompt is the highest editorial authority, followed by the episode's central intent and then sources. GET `/api/agent/channel` before every creative task; it returns the private Markdown profile, its independent version and the priority order. Agents cannot modify it. Read the complete [editorial authority contract](native-agent.md#domain-authority), including conflict handling, freshness and keeping internal principles out of published content. All four production prompts embed the current saved channel profile.

Owners edit `/admin/channel`; GET/PUT `/admin/api/channel` read/save the full Markdown document with optimistic versioning and the existing Access/same-origin protection. Initial content derives from the owner's README principles and is initialized once; later reads or deployments never overwrite saved edits. Changes do not automatically alter existing approvals or media.

## Authentication

A signed-in human creates a token from the studio. Token management lives under Cloudflare Access at `/admin/api/agent-tokens`:

| Method | Path | Body or result |
| --- | --- | --- |
| GET | `/admin/api/agent-tokens` | `{ "tokens": [...] }`; metadata only |
| POST | `/admin/api/agent-tokens` | `{ "name": "Local coordinator", "expiresInDays": 30 }` → `{ "token": "...", "record": {...} }` |
| DELETE | `/admin/api/agent-tokens/:id` | Revokes immediately; `204` |

The complete token appears only in the creation response. Store it in the selected website entry of the private local agent configuration. The database keeps a SHA-256 hash, a short identifying prefix, expiry and revocation timestamps. Tokens expire after the requested number of days, from 1 through 365. Successful authentication updates `lastUsedAt`.

Agent requests use `Authorization: Bearer <token>` at `/api/agent/`. An expired, revoked or invalid token returns `401`. A token cannot access human studio endpoints, approval actions, production settings or publication confirmation.

## Runtime and read routes

Machine mutation authority is only available on the enrolled coordinator connection. The previous direct REST write methods under `/api/agent/productions` return `409 runtime_required`; they are not a compatibility path. Human studio routes remain at `/admin/api/productions` and retain their existing permissions.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/agent/productions` | Read saved productions |
| GET | `/api/agent/productions/:id` | Read exact production version |
| GET | `/api/agent/productions/:id/prompts` | Current channel-aware production prompts |
| GET | `/api/agent/runtime/connect` | WebSocket upgrade, Bearer + `X-Hisfm-Station`; explicit owner enrollment required |
| GET | `/api/agent/runtime/receipts/:id` | Exact operation outcome (`200`), or pending (`202`) |
| GET/POST | `/admin/api/agent/station` | Human reads/binds `{tokenId,stationId,version}`; initial version is 0 |
| GET | `/admin/api/agent/live` | Same-origin authenticated browser WebSocket |
| GET | `/admin/api/agent/snapshot` | Bounded messages/commands/roles/pending proposals |
| GET | `/admin/api/agent/history?kind=messages&before=N` | Paginated durable history; `kind=proposals` also supported |

WebSocket schemas are exported from `@his-fm/contracts` and advertised by OpenAPI. Browser context/command frames carry typed route/entity/field/draft/selection state. Commands retain their original immutable context independently of newer live page events. Agent frames persist messages, statuses and proposals before `event.ack`; operations receive exact `operation.result` receipts. Browser `delivery.ack` bounds the outstanding delivery window.

Supported typed operations: `production.create`, `production.patch`, `production.action` (only submit_brief/submit_script/submit_final), and `audio.request`. Every operation has stable `id` and `commandId`; mutations of an existing production require the command's matching production scope and expected version. Source records contain a stable `id`; positions are not identities. Current runtime tools never receive human-only approval or publication capability.

## Review sequence

`draft → brief_review → scripting → script_review → production → final_review → ready`

1. Create and edit the brief in `draft`. Add source material and a concrete editorial intention, then call `submit_brief`.
2. Wait for human `approve_brief`. Human `revise_brief` returns to `draft` with feedback.
3. In `scripting`, write the transcript and call `submit_script`. Human `approve_script` opens `production`; `revise_script` returns to `scripting`.
4. In `production`, fill `summary` and `description`, upload clean unframed cover artwork, and start cloud audio generation. Read `production.audioJob` for progress. A local agent cannot upload its own audio through this API.
5. Call `submit_final` after all assets match the current script version and the audio job has completed. Human `approve_final` moves the record to `ready`; `revise_assets` returns it to `production`.
6. A human publishes through the destination platform and records the actual URL in the studio. This manual confirmation creates or updates the public his.fm episode snapshot.

Agents may call `submit_brief`, `submit_script` and `submit_final`. All approval, revision and reopen actions require a human. Revision and reopen actions require nonempty feedback, retained in the production's append-only `events` history and included in generated prompts.

Editing rules:

| Stage | Editable fields |
| --- | --- |
| `draft` | Brief fields |
| `scripting` | `transcript`, `category`, `tags` |
| `production` | `summary`, `description`, `category`, `tags` |
| Review stages and `ready` | None; use the appropriate human action |

`reopen_script` preserves existing material while clearing the active audio job and script/final approvals. `reopen_brief` also clears brief approval. Both advance `scriptVersion`, so obsolete jobs cannot attach to the reopened work. `reopen_assets` retains the approved script and existing assets while clearing final approval. Existing public episode snapshots and prior publication records remain unchanged until the next human-confirmed publication.

## Versioning and errors

Every mutation requires the version just read. Successful updates advance `version`. Concurrent changes return `409`; read the latest record, preserve the other change and decide whether the intended update still applies. Do not blindly retry an old full record. Server-owned audio updates use a functional compare-and-swap helper to preserve simultaneous description and cover edits.

Common responses are `400` for invalid input, `401` for token authentication, `403` for human-only actions, `404` for a missing record, `409` for stage/version conflicts, `413` for oversized input and `415` for invalid media. Agent error responses are `{ "error": "message", "code": "category", "documentation": "URL" }`.

The JSON body limit is 750,000 bytes. Each production preserves up to 200 audit events. The API explicitly rejects further changes at that limit instead of silently removing history; start a new task if further revisions are required.

## Cover upload

Generate clean square cover artwork locally with the workflow GPT Image 2.5 Sunburst skill. The generated, uploaded and stored image must not contain text, logos, borders, brand frames or overlay layers. Preserve the original and exact prompt. The studio adds branding only when the owner downloads the finished cover; never upload that composite as the source.

The owner cover endpoint accepts actual raster bytes with the correct `Content-Type`: `image/png`, `image/jpeg` or `image/webp`. The endpoint checks file signatures and bounded content, rejects SVG and arbitrary URLs, and accepts at most 8 MiB. Human final review verifies that the source is unframed and suitable; the byte validator does not inspect the image's visual content.

Each successful upload uses a new immutable R2 key. A stale database update removes the new unreferenced upload. Production URLs use `https://f.no.mt`; local URLs use `/media/` and local R2. The API cannot attach an arbitrary external asset URL to bypass upload and approval.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $HISFM_AGENT_TOKEN" \
  https://his.fm/api/agent/productions

```

## Manual publication confirmation

Human-only `POST /admin/api/productions/:id/publications` accepts `{ version, platform, url, publishedAt }`. The stage must be `ready`, final approval must exist, and summary, description, cover and completed audio must belong to the current script version. `publishedAt` is an actual past or present timestamp, not a schedule.

`wechat` URLs must belong to `mp.weixin.qq.com`; `xiaoyuzhou` URLs must belong to `xiaoyuzhoufm.com`. Their subdomains are accepted. A confirmation records who confirmed it, when and which production version was used. It makes no claim that his.fm called a destination publishing API.

The confirmation and public snapshot are committed in one D1 transaction. A concurrent reopen, conflicting public slug or unrelated episode ID prevents both writes. Separate source-production ownership protects existing manual catalog entries from being overwritten by the snapshot upsert.


## Cloud narration

The typed `audio.request` operation invokes the shared audio controller with `{ version, voice?, speakingStyle?, includeBumpers? }`. Omitted voice/style use saved studio defaults; `includeBumpers` defaults to false. The script must be approved. The endpoint returns `202` with the queued production; poll `GET` until `audioJob.status` is complete or failed. A queued job is redispatched with its original snapshot rather than new options.

A completed narration is stored in R2 and attached as `assets.audio`, including the CDN `url`, `durationSeconds`, `voice`, `includesBumpers` and `scriptVersion`. Selecting bumpers requires both configured files. A preview is available only through the owner endpoint described in [Audio implementation](audio.md).
