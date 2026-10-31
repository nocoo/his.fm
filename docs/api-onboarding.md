# his.fm external API onboarding

his.fm is a podcast content-management site. External clients create text, artwork and recordings outside the site, then use scoped REST to manage content. There is no embedded agent, native station, task queue, generation endpoint, MCP or A2A service.

## Connect

- API base: `https://his.fm/api/agent`.
- Public discovery: `/api/agent`, `/.well-known/api-catalog`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, `/feed.xml`, `/feeds/{categoryId}.xml`, `/api/card` (episode embed cards; see [card-api.md](card-api.md)).
- OpenAPI 3.1: `/api/agent/openapi.json`. Read actual paths and `x-required-scopes`; do not guess endpoints.
- Obtain a token from the owner at `/admin/connections`; send `Authorization: Bearer <token>` over HTTPS. Never put it in a URL, prompt, log, source file or browser bundle.
- Verify with `GET /me`, then `GET /capabilities`. Discovery being reachable does not prove authentication.

```sh
curl --fail-with-body https://his.fm/api/agent/me \
  -H "Authorization: Bearer $HISFM_TOKEN"
```

Use only the environment explicitly authorized by the owner. Local and production tokens/data are separate. Technical permission is not approval to incur external cost, publish real content or delete media.

## Scopes

| Module | Finite grants |
| --- | --- |
| Productions | `productions:read`, `productions:write`, `productions:delete`, `productions:submit`, `productions:approve`, `productions:reopen` |
| Publication records | `publications:read`, `publications:write`, `publications:delete` |
| Standalone episodes | `episodes:read`, `episodes:write`, `episodes:delete`, `episodes:publish` |
| Categories | `categories:read`, `categories:write`, `categories:delete` |
| Prompts and site SEO | `prompts:read`, `prompts:write` (`GET`/`PUT /seo` for defaults, RSS metadata and global page overrides) |
| Appearance | `appearance:read`, `appearance:write` |
| Bumpers | `bumpers:read`, `bumpers:write`, `bumpers:delete` |
| Media storage | `storage:read`, `storage:write`, `storage:delete` |
| Tokens | `tokens:read`, `tokens:issue`, `tokens:revoke`, `tokens:delete` |

There is no wildcard. Reader/editor/owner presets expand to explicit grants; the owner preset selects all current grants. Approval does not imply reopening; writes do not imply reads. No grant bypasses version checks, linked snapshot protection, media validation or reference-safe cleanup.

`PUT /seo` requires the current `version` and preserves omitted fields. Podcast
settings include `podcastCoverUrl` (JPEG/PNG URL or empty), `podcastOwnerEmail`
(approved public contact or empty) and `podcastAuthorType` (`Person` or
`Organization`). Empty artwork settings use the bundled Stillwood JPEG brand
images; an empty owner email remains a launch blocker. Custom image dimensions
and color space require separate verification. See [SEO operations](seo.md).

## Editorial preparation

Read `GET /channel/prompt-slots` with `prompts:read` before creative work, then `GET /categories/{id}/prompt-slots?slot=editor,collector` for merged role guidance. Use whole-table reads to discover stable IDs and collection versions. Priority is **global prompt -> category prompt -> episode intent -> sources**; facts and permissions are not overridden by prose.

Saved workflow/voice/compaction prompt keys are templates for external use, not executable site features. Internal editorial policy should guide writing without being recited as a public slogan. Sources must be verified externally; the website stores references and does not fetch arbitrary URLs.

### Prompt slots

Prompt slots use `GET/PUT/POST /channel/prompt-slots` and `/categories/{id}/prompt-slots`, plus `PATCH/DELETE /{slotId}`. Paths are relative to `/api/agent`; authenticated owner routes use `/admin/api`. Reads require `prompts:read`; writes require `prompts:write`. Mutations use the collection version; write-only responses contain only `version`. Category `append` adds after the same channel ID; `override` replaces it. Uninitialized tables are empty at version 0 until the first save. `GET /channel` returns editorial priority only. Legacy whole-prompt fields and migration endpoints were removed in 2.11.11. Category metadata writes reject a supplied legacy `prompt`.

Tables return `{version,initialized,slots}`. Whole-table PUT is `{version,slots}`; POST adds one slot; PATCH/DELETE target `{slotId}` with `?version=N`. `?slot=editor,collector` returns merged enabled slots and Markdown `body`. Production prompt reads merge channel and category slots. See [prompt slots](prompts.md).

## Versioned production workflow

1. `POST /productions` creates a validated brief with `productions:write`. Read `/productions/:id` and `/productions/:id/capabilities` using `productions:read`.
2. `PUT /productions/:id` updates permitted fields with the current `version`. `GET /productions/:id/prompts` requires both `productions:read` and `prompts:read`.
3. `POST /productions/:id/actions` accepts `{version, action, feedback?, changes?}`. Submitting needs `productions:submit`; `approve_*` needs `productions:approve`; `revise_*` and `reopen_*` need `productions:reopen`. Atomic `changes` also require edit authority.
4. Save the externally written transcript; approve the current script before attaching its recording.
5. Upload clean cover and finished WAV, then save summary/description. Submit and approve final material after validating the exact assets.
6. Publish manually on the external platform and record the real URL/time through the publication API with `publications:write`.

Stored stages are `draft`, `brief_review`, `scripting`, `script_review`, `production`, `final_review`, `ready`. Reopening invalidates dependent approvals without deleting assets or history. IDs, timestamps, versions and audit/approval records are server-owned; never fabricate a completed state or overwrite a linked episode to bypass review.

## Media

- `PUT /productions/:id/assets/cover?version=N`: raw PNG/JPEG/WebP, matching Content-Type, at most 8 MiB. Source artwork must not contain text, branding, frames or overlays.
- `PUT /productions/:id/assets/audio?version=N`: raw `audio/wav` or `audio/mpeg`, Content-Length required, positive duration up to 7,200 seconds. WAV must be 24 kHz mono PCM16 (max 345,665,536 bytes). MP3 must be valid MPEG Layer III (max 288,065,536 bytes; 96–128 kbps mono recommended). The server derives duration; no multipart or duration metadata. It requires an approved current script.
- `POST /productions/:id/assets/audio/bind`: JSON `{version,key}` attaches WAV or MP3 already uploaded to R2, with the same limits, approval and reopening rules. Allowlisted keys are `uploads/<uuid>.{wav|mp3}` or `productions/<id>/audio-<scriptVersion>-<uuid>.{wav|mp3}` for this production and current script. Staging sources are copied and retained; cleanup is a separate authorized action. Uploading out-of-band with the project `cf` CLI requires independently authorized infrastructure access; website tokens cannot upload through Cloudflare's API.
- Both uploads and `DELETE /productions/:id/assets/{cover|audio}?version=N` require `productions:write` plus `storage:write` and the applicable stage policy. Changing reviewed assets requires `productions:reopen`. Detach retains immutable R2 bytes.
- `POST /storage` uploads safe raster, PCM WAV or MP3 up to 25 MiB to a server-chosen immutable `uploads/<uuid>` key, without attaching it to a production.
- Optional `POST /storage?key=reference/voices/<name>.mp3` with `Content-Type: audio/mpeg` writes or replaces a voice-preview reference MP3 at that exact R2 key (`storage:write` only; no path traversal; overwrite allowed). No other query parameters may accompany `key`. Objects under `reference/voices/` stay exempt from unreferenced 24-hour cleanup.
- `POST /bumpers?name=...&position=intro|outro` accepts PCM WAV up to 30 seconds/3 MiB with `bumpers:write`. Metadata updates use PUT plus version; deletion uses `?version=N` and retains physical media.

```sh
curl --fail-with-body -X PUT \
  "https://his.fm/api/agent/productions/$PRODUCTION_ID/assets/audio?version=$VERSION" \
  -H "Authorization: Bearer $HISFM_TOKEN" \
  -H 'Content-Type: audio/wav' --data-binary @finished.wav
# MP3 uploads use Content-Type: audio/mpeg and keys ending in .mp3 when binding out-of-band.
```

Fetch the new version after every successful mutation. Never blindly retry a body after a conflict.

### Cached podcast and share artwork

Uploading a clean cover with `PUT /api/agent/productions/{id}/assets/cover?version=N` pregenerates the production's square podcast art and landscape share image as immutable generated R2 objects before publication, using the same path as studio cover uploads. Publication and republication warm the linked episode's current artwork keys. Only generated outputs are cached; the original upload remains unchanged. Storage cleanup protects current generated versions and may reclaim superseded versions subject to the existing safety rules.

Provide a clean **1400 x 1400 square original**; smaller originals are accepted and upscaled without inventing detail. Do not add text, branding, borders or overlays. Keep the main subject near **x = 50%, y = 40%** for the landscape share crop. On a square original, that crop spans **y = 13.75-66.25%**; keep essential details inside this safe area and clear of the finished border and wordmark. Square art keeps a centered artwork window in the active website theme; landscape sharing remains theme-independent.

Public `GET|HEAD /episodes/{id}/art.jpg` and `GET|HEAD /episodes/{id}/share.jpg` serve only currently published, non-future episode snapshots; warming a production does not expose its draft. These stable record-ID URLs resolve to current versioned URLs: `art.jpg?v=<hash>` (optionally with `&size=N`) and `share.jpg?v=<hash>`. Square art defaults to **1400 x 1400** and retains `?size=N` for integers from **1400 through 3000**; landscape sharing is **1200 x 630**. Versioned URLs serve immutable generated artwork from edge cache or R2. Relevant cover, title, episode number, category or website-theme changes select a new square-art version; landscape sharing is independent of the website theme. An edge miss reads R2; only a missing generated R2 object triggers rendering and storage without changing the original.

Successful versioned artwork responses and 304s include x-hisfm-art: edge-hit | r2-hit | rendered. After successful cover upload/publication warming, the first default 1400-square art or share GET should report r2-hit (pregenerated), not rendered (lazy fallback); an already warm edge may report edge-hit. Repeat GETs to the same full versioned URL at the same edge should become edge-hit after asynchronous cache fill, not globally guaranteed. Other sizes may render. HEAD reads cached GET metadata without a body and cannot warm the edge; cold HEAD/304 may use only R2 metadata without populating it. Conditional 304s honor the same ETag and Last-Modified validators.

To verify in an authorized environment, GET each plain artwork URL to discover its current redirect, then use `curl --fail -sS -D - -o /dev/null "$VERSIONED_ART_URL"` with the exact resolved URL (including all query parameters). Inspect `x-hisfm-art`, `ETag`, `Last-Modified` and `Cache-Control`; repeat the GET after asynchronous cache fill. Use `-I` only to check HEAD metadata, not to warm the edge. Send the returned ETag with `-H 'If-None-Match: <etag>'` to check a bodyless 304 and its diagnostic header. Edge-hit verification requires a deployed Cloudflare edge; local emulation cannot establish global cache behavior.

Plain and stale-version URLs return no-store 302 redirects so withdrawal and version changes remain immediately visible to the Worker. Current publication/version checks precede edge lookup; only a missing generated R2 object triggers rendering, not an edge miss alone.

## Finished-cover PNG

Read a saved original and its current metadata as one themed image:

- `GET /productions/:id/cover.png?theme=<id>&version=N` requires `productions:read`.
- `GET /episodes/:id/cover.png?theme=<id>&version=N` requires `episodes:read`, including for a published production snapshot.
- `theme` is mandatory: `grove`, `interval`, `soft-landing`, `human-sample`, `stillwood`, `tidal-hours`, `window-seat` or `alpine-bloom`.
- `version` is an optional positive integer; send the saved version to detect stale input. Unknown or repeated query parameters are rejected.

Success is a binary **1600 x 1600 PNG**, not JSON, SVG or layered HTML. Headers include `Content-Type: image/png`, an attachment filename, `X-Cover-Theme`, `X-Resource-Version` and `Cache-Control: private, no-store`. The equivalent `/admin/api/...` routes serve authenticated studio downloads. No storage, write, approval or publication grant is needed, and no original, record or published snapshot is changed.

```sh
curl --fail \
  "$HISFM_API_BASE/episodes/$EPISODE_ID/cover.png?theme=window-seat&version=$VERSION" \
  -H "Authorization: Bearer $HISFM_TOKEN" \
  --output "his-fm-$EPISODE_ID-window-seat.png"
```

Set `HISFM_API_BASE` to the authorized environment's `/api/agent` base. Originals must already be saved at a supported same-origin image/media path or the configured media CDN. The Worker reads the configured R2/ASSETS bindings; it never fetches an arbitrary external cover URL. Local development maps only the three known seeded CDN episode images to their bundled local copies.

Export accepts static PNG/JPEG/WebP up to **4 MiB**, **4,000,000 pixels**, and **8192 pixels per side**; production uploads retain their separate 8 MiB limit. The selected font set is bounded to 2 MiB. Missing originals return 404; missing saved covers or stale versions return 409; size limits return 413; unsupported, animated or invalid image headers return 415; failed pixel decoding/rendering returns 422. A busy isolate returns 503 with `Retry-After: 1`; unavailable frame/font assets also fail explicitly. Do not save an error response as a PNG or silently replace the requested theme. Finished images are derivatives: never upload one back as the clean source.

## Publication and episodes

`POST /productions/:id/publications` records `{version, platform, url, publishedAt}`. Platforms are `wechat` and `xiaoyuzhou`, with matching HTTPS hostnames and an actual non-future time. Current final approval/assets are required. This records publication; it does not post to the external platform.

`PATCH /productions/:id/publications/:platform` corrects the record using the same complete body, including the matching platform. `DELETE .../:platform?version=N` withdraws it with `publications:delete`. Events remain in the audit. The last withdrawal makes the linked website episode draft; it does not expose an in-progress revision. `GET /productions/:id/publications` requires `publications:read`.

Standalone `/episodes` supports POST/GET and `/:id` GET/PUT/DELETE. PUT includes version; DELETE uses `?version=N`. Publishing/changing published standalone content additionally requires `episodes:publish`. Linked production snapshots reject standalone content writes/deletion. `PATCH /episodes/:id` permits only `{version, featured}` display metadata.

### Episode structure

Since release 2.11.5 the episode body is structured data, not one Markdown document. `showNotes` no
longer exists on any request or response, and `description` no longer exists on a production.
Requests that still send them fail with `400 Unrecognized key: "showNotes"` or
`400 Unrecognized key: "description"` because both schemas are strict.

| Old field | Replacement |
| --- | --- |
| `showNotes` (whole Markdown body) | `lead` + `topics` + `body` + `researchNote` + `credits` |
| `production.description` | the same five fields on the production |
| `mentions` | unchanged in shape; still an ordered array of `{name, description, url?}` |

Field reference. Send only what the episode actually has; every prose field accepts Markdown and is
sanitised on render.

| Field | Type | Limits | Use for |
| --- | --- | --- | --- |
| `lead` | string | 4,000 chars | the opening paragraph: where this episode starts and why |
| `topics` | array | 1-30 items, in broadcast order | what the episode covers, one entry per item |
| `topics[].title` | string | 1-120 chars, plain text | the topic name, e.g. `实验室怎样关住训练中的模型` |
| `topics[].detail` | string | 2,000 chars, default `""` | two or three sentences of substance |
| `topics[].sourceUrls` | array | 8 entries, HTTPS only | links cited by that one topic |
| `body` | string | 20,000 chars | any remaining prose that is not a topic, note or credit |
| `researchNote` | string | 4,000 chars | methodology and boundaries, e.g. which numbers are 据称 |
| `credits` | string | 4,000 chars | narration voice, music attribution, licence |
| `mentions` | array | 50 items | the episode-wide source list; `name` <=200, `description` <=500 |

```json
{
  "version": 7,
  "lead": "agent 手里有了终端、浏览器，有的已经能替你登录真实账号。这一期往前走一步：它的边界该怎么划。",
  "topics": [
    {
      "title": "实验室怎样关住训练中的模型",
      "detail": "OpenAI 公开训练环境的隔离做法：一次 DNS 配置错误后暂停最强模型的训练和评估 11 天，并用高算力红队假设内层已经失守再测外层。Anthropic 复盘 Mythos 5 在 AISI 测试中越界，43 次运行里 9 次影响了真实的人和组织。",
      "sourceUrls": [
        "https://openai.com/index/securing-our-frontier-model-training-environment/",
        "https://www.anthropic.com/research/alignment-assessment-ukaisi"
      ]
    },
    {
      "title": "补丁窗口越缩越短",
      "detail": "Drew Silcock 主张补丁公布即应视为利用将至；Brotli 解压漏洞第二次跟进，受影响范围扩到 PyPI 包，Node.js 与 Bun 已给出修复版本。",
      "sourceUrls": ["https://drew.silcock.dev/blog/is-this-the-new-cyber-normal/"]
    },
    {
      "title": "让 agent 用钥匙却看不见钥匙",
      "detail": "1Password for AI Agents 让 agent 申请、用户批准、由 1Password 代填；Claude Duet 把凭据隔离在模型之外。",
      "sourceUrls": ["https://1password.com/blog/1password-for-ai-agents"]
    }
  ],
  "body": "",
  "researchNote": "公司和项目自报的数字一律按「据称」处理；安全相关内容只讲防御与自查。",
  "credits": "本期旁白采用 AI 合成。片头片尾音乐：Ondrosik — Short piano jingle（CC0）。",
  "mentions": [
    {
      "name": "OpenAI：Securing our frontier model training environment",
      "description": "训练环境隔离做法与暂停训练的说明。",
      "url": "https://openai.com/index/securing-our-frontier-model-training-environment/"
    }
  ]
}
```

Writing rules:

- One idea per topic. If a topic needs more than three sentences, it is probably two topics.
- Put concrete nouns, numbers and attributions in `detail`; keep `title` a label, not a sentence.
- `sourceUrls` belongs to the topic it supports. The episode-wide list goes in `mentions`, which is
  what the public page prints under 本期提到 and what RSS and structured data read.
- `lead` is the only opening prose. Do not repeat it in `body`.
- Do not repeat the episode title, the duration or the narration name: those already exist as
  `title`, `durationSeconds` and the audio asset.
- Markdown is allowed in the five prose fields. Raw HTML, images and script URLs are stripped.
- `mentions` items are `{name, description, url?}`: `name` and `description` are required,
  `description` is one sentence, and `url` must be `http` or `https` when present.

Semantics on write:

- Omitting `topics` or `mentions` on an update preserves what is stored; sending `[]` clears it.
  Replacing the array is a full replacement in the given order.
- Standalone episodes use `POST /api/agent/episodes` and `PUT /api/agent/episodes/{id}` with the same
  five fields; `PUT` includes `version`.
- Productions use `PUT /api/agent/productions/{id}` in the `production` stage with the same fields
  plus `version`, then `POST /api/agent/productions/{id}/actions` with
  `{"version": N, "action": "submit_final"}`. Final review now requires `summary`, **at least three
  topics**, the current cover and the current audio.

The existing catalogue is already migrated, so previously published work needs no action and is a
good reference: `GET /api/agent/episodes` with `episodes:read` lists the catalogue, and
`GET /api/agent/episodes/{id}` returns `lead`, `topics`, `body`, `researchNote`, `credits` and
`mentions` for any of the thirteen published episodes. Read one before writing a new episode body:
the released episodes show the intended density of titles and details. The prompt slot named
`description` still exists and still guides this copy, but its output is now the structure above
rather than one Markdown blob.

Public payloads follow the same structure: `GET /api/episodes/{category}/{slug}` returns `lead`,
`topics`, `body`, `researchNote`, `credits` and `mentions` but never the transcript, while the
catalogue `GET /api/episodes` stays a light summary with neither collection.

Production briefs/patches also accept optional `seo` with the existing page override
fields (`title`, `description`, `ogImageUrl`, `noindex`). A metadata SEO change
revokes current final approval, not script approval. Only explicit reviewed
publication/correction copies it to the public snapshot. An omitted field preserves
existing SEO, including legacy production snapshots; explicit `seo: {}` clears
episode-specific overrides on the next publication. Linked snapshots still reject
standalone content edits.

```json
{
  "mentions": [
    {
      "name": "HowToLiveBetter",
      "description": "一本关于生活节奏的开放读物。",
      "url": "https://github.com/eternity4719/HowToLiveBetter"
    }
  ]
}
```

## Other modules and safe deletion

- Categories: GET/POST `/categories`, GET/PUT/DELETE `/categories/:id`. Private reads need `categories:read`. PUT updates metadata partially with its current version; supplying legacy `prompt` is rejected. Optional `nextId` renames the stable ID and updates episode/production references in one transaction. Edit prompts through `/categories/:id/prompt-slots` with `prompts:write`; referenced categories cannot be deleted.
- Channel: GET `/channel` returns editorial priority with `prompts:read`; PUT returns 405. Edit `/channel/prompt-slots` with `prompts:write`; write-only slot responses return only the collection version.
- Appearance: GET/PUT `/appearance`; PUT uses current version and a known theme ID.
- SEO: GET/PUT `/seo` uses `prompts:read` / `prompts:write`. PUT is partial plus the current version and preserves omitted settings. `podcastAuthorUrl` is HTTPS or empty; `podcastOwnerEmail` must be owner-supplied. Empty `podcastCoverUrl` and `defaultOgImageUrl` use bundled brand JPEGs without writing settings. See `docs/seo-content-checklist.md` for artwork and identity fields.
- Storage: GET `/storage?cursor=...` must follow all cursors. GET/HEAD `/storage/object?key=...` streams single byte ranges. DELETE `/storage/object?key=...&version=...` or POST `/storage/cleanup` with `{items:[{key,version}]}` needs `storage:delete` and reports per-object results, not unconditional deletion.

Cleanup protects current references (including site/episode/category SEO and mention URLs), current generated podcast/share artwork versions, retained media provenance, `images/`, `reference/` and uploads younger than 24 hours. Superseded generated versions may be reclaimed subject to the same safety rules. Failed reference-query batches block deletion. It cannot prove an object has no external users or atomically coordinate arbitrary R2 overwrites with D1; avoid concurrent reference changes. Deletion does not purge CDN caches.

## Delegation and response privacy

`POST /agent-tokens` requires `tokens:issue` and `{name, expiresInDays, scopes}`: 1-365 days, explicit nonempty unique grants. A machine issuer cannot grant beyond its own scopes or expiry; a live DB fence rechecks this at insertion. The raw token is shown once.

`POST /agent-tokens/:id/revoke` requires `tokens:revoke` and revokes descendants. `DELETE /agent-tokens/:id` needs `tokens:delete` and prior revocation, preserving a tombstone/ancestry. Machines cannot manage targets outside their grants. GET requires `tokens:read` and never reveals hashes or raw values. Unknown/empty grants cannot authenticate; invalid stored metadata may be shown only to facilitate cleanup.

Write-only production, episode and bumper calls acknowledge `{id, version}` inside their resource envelope. Publication arrays/events and category prompt bodies are projected by their independent read grants. Do not assume write responses contain existing private data.

Errors use HTTP status and `{error, code, documentation}`: 401 invalid/expired/revoked token, 403 missing authority, 409 changed version or invalid business state, 413/415 invalid media size/type. Read the error and latest authorized state; do not escalate grants, forge a version or retry destructive writes automatically.
