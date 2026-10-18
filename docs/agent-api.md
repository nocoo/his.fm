# External content-management API

The bearer namespace remains `/api/agent` for external agents and other API clients. It is a scoped REST interface to the podcast CMS, not an embedded agent service. Start with [onboarding](api-onboarding.md), [scope policy](scoped-api.md) and the generated `/api/agent/openapi.json` contract.

## Boundary

Owner `/admin/api` and bearer `/api/agent` requests share resource controllers and business validators. Access sessions have owner authority; bearer requests carry finite scopes. No station enrollment or browser Origin is required for bearer REST. Models, provider settings, task queues and realtime execution are not part of the service.

The complete scope catalogue covers productions, publication records, standalone episodes, categories, prompts, appearance, bumpers, storage and tokens. A fully authorized token can complete the entire website workflow; it cannot mutate internal database fields, deploy infrastructure or post to external platforms. Privileges never bypass business checks.

## Route catalogue

Paths are relative to `/api/agent`:

| Resource | Methods and contract |
| --- | --- |
| `/me`, `/capabilities` | GET authenticated identity and current capability metadata |
| `/productions` | GET list; POST validated brief |
| `/productions/:id` | GET detail; PUT versioned partial business fields; DELETE with version |
| `/productions/:id/capabilities` | GET actor-specific actions, editable fields and upload availability |
| `/productions/:id/prompts` | GET current private production guidance |
| `/productions/:id/actions` | POST explicit submission, approval or reopening |
| `/productions/:id/assets/cover` | PUT raw safe raster; DELETE detach; query version |
| `/productions/:id/assets/audio` | PUT raw validated WAV or MP3; DELETE detach; query version |
| `/productions/:id/assets/audio/bind` | POST `{version,key}` to attach an existing validated R2 WAV or MP3 |
| `/productions/:id/publications` | GET current records; POST actual publication |
| `/productions/:id/publications/:platform` | PATCH correction; DELETE withdrawal |
| `/episodes[/:id]` | GET; POST create; PUT existing; DELETE existing |
| `/episodes/:id` | PATCH only version and featured metadata |
| `/categories[/:id]` | GET; POST create; PUT partial versioned changes; DELETE unreferenced |
| `/channel` | GET/PUT versioned global content and named prompt bundle |
| `/seo` | GET/PUT versioned site defaults, podcast RSS metadata and global page overrides (`prompts:read` / `prompts:write`) |
| `/appearance` | GET/PUT versioned theme |
| `/bumpers[/:id]` | GET; POST WAV upload; PUT versioned metadata; DELETE catalogue record |
| `/storage` | GET cursor scan; POST safe immutable upload |
| `/storage/object` | GET/HEAD preview; DELETE using key and object version |
| `/storage/cleanup` | POST bounded versioned cleanup list |
| `/agent-tokens` | GET metadata; POST bounded delegation |
| `/agent-tokens/:id/revoke` | POST cascading revocation |
| `/agent-tokens/:id` | DELETE already revoked list record |

OpenAPI derives request schemas from shared/controller validators; use its `x-required-scopes` plus documented conditional grants. Zod input transformations such as publication timestamps must be represented as input schemas, not serialized output transforms. Generating the actual document is covered by tests.

## Critical invariants

Publication accepts `platform: "site"` with `{version,platform,publishedAt}` to
publish the approved snapshot without an external URL. `wechat` and `xiaoyuzhou`
still require `{version,platform,url,publishedAt}` with a matching platform HTTPS
URL. All platforms require current final approval and reject future timestamps;
no endpoint posts to an external platform.

- Existing-resource mutations use optimistic versions; production/episode/category/bumper versions are integers, storage versions are opaque R2 strings.
- `approve_*` requires `productions:approve`; `revise_*` and `reopen_*` require `productions:reopen`. Atomic action changes additionally obey edit scopes.
- Upload/detach requires `productions:write` and `storage:write`; production audio attaches only to an approved current script. No synthetic completed job is needed.
- Cover uploads through `PUT /productions/:id/assets/cover?version=N` pregenerate immutable R2 podcast/share artwork before publication, just like studio uploads; publication and republication warm the linked episode's keys. Use clean 1400 x 1400 square originals (smaller accepted), with the share subject near x = 50%, y = 40% and essential details within y = 13.75-66.25% on square originals. Published-only `/episodes/{id}/art.jpg` and `/episodes/{id}/share.jpg` resolve to versioned URLs (`art.jpg?v=<hash>`, optionally with `&size=N`, and `share.jpg?v=<hash>`). Square art follows the website theme and defaults to 1400 square (1400-3000 accepted); 1200 x 630 sharing is theme-independent. Cache generated outputs, not originals, and protect current generated versions during cleanup. See [the full artwork contract](api-onboarding.md#cached-podcast-and-share-artwork).
- Production audio accepts `audio/wav` (24 kHz mono PCM16, up to 172,865,536 bytes) or `audio/mpeg` (up to 144,065,536 bytes), with a shared 3,600-second duration cap. Binding uses the same approval, reopening and limits as raw uploads. Accept `uploads/<uuid>.{wav|mp3}` or this production's `productions/<id>/audio-<scriptVersion>-<uuid>.{wav|mp3}`. Staging uploads are copied to immutable production keys and retained even if binding fails; removal requires separate reference-safe storage cleanup. Out-of-band R2 uploads require separate infrastructure authorization, not a website token.
- Publication/correction updates the current platform record and appends audit history. Withdrawal preserves the audit, immutable media and last reviewed snapshot content.
- Linked episodes cannot be edited/deleted through standalone CRUD. Their independently versioned featured flag remains editable and survives republication.
- Production briefs and episode writes accept ordered `mentions` (max 50): `{name, description, url?}` with required `name` and one-sentence `description`; optional `url` must be `http` or `https`. Public `/api/episodes` includes `mentions`, resolved `pageSeo` and `canonical`, and never returns full transcripts or raw `seo` overrides.
- Category and episode bodies accept optional `seo` overrides: `{title?, description?, ogImageUrl?, noindex?}`. Public `/api/categories` exposes category `seo` for catalogue pages; episode overrides affect resolved `pageSeo` only.
- Write does not grant read: production/episode/bumper receipts may be only resource `{id, version}`; channel may be `{version}`. Prompt and publication projections are independent.
- Stored invalid grants are never normalized into valid authority. Revocation/deletion can clean up such records without issuing new rights.

Successful versioned artwork responses and 304s include x-hisfm-art: edge-hit | r2-hit | rendered. After successful cover upload/publication warming, the first default 1400-square art or share GET should report r2-hit (pregenerated), not rendered (lazy fallback); an already warm edge may report edge-hit. Repeat GETs to the same full versioned URL at the same edge should become edge-hit after asynchronous cache fill, not globally guaranteed. Other sizes may render. HEAD reads cached GET metadata without a body and cannot warm the edge; cold HEAD/304 may use only R2 metadata without populating it. Conditional 304s honor the same ETag and Last-Modified validators.

## Testing

Worker tests use actual Miniflare D1/R2 and scoped fixtures. They cover a full external upload/review/publication workflow, denials, projected responses, token delegation, snapshots, storage references and migration preservation. Browser tests cover the owner interface and custom playback separately. Local verification uses synthetic media and does not imply production validation.
