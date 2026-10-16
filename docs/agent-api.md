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
| `/productions/:id/assets/audio` | PUT raw validated PCM WAV; DELETE detach; query version |
| `/productions/:id/assets/audio/bind` | POST `{version,key}` to attach an existing validated R2 WAV |
| `/productions/:id/publications` | GET current records; POST actual publication |
| `/productions/:id/publications/:platform` | PATCH correction; DELETE withdrawal |
| `/episodes[/:id]` | GET; POST create; PUT existing; DELETE existing |
| `/episodes/:id` | PATCH only version and featured metadata |
| `/categories[/:id]` | GET; POST create; PUT partial versioned changes; DELETE unreferenced |
| `/channel` | GET/PUT versioned global content and named prompt bundle |
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
- Upload/detach requires `productions:write` and `storage:write`; WAV attaches only to an approved current script. No synthetic completed job is needed.
- Audio binding uses the same approval, reopening and 1,800-second/86,465,536-byte limits as raw uploads. Accept only `uploads/<uuid>.wav` or this production's `productions/<id>/audio-<scriptVersion>-<uuid>.wav`. Staging uploads are copied to immutable production keys and retained even if binding fails; removal requires separate reference-safe storage cleanup. Out-of-band R2 uploads require separate infrastructure authorization, not a website token.
- Publication/correction updates the current platform record and appends audit history. Withdrawal preserves the audit, immutable media and last reviewed snapshot content.
- Linked episodes cannot be edited/deleted through standalone CRUD. Their independently versioned featured flag remains editable and survives republication.
- Write does not grant read: production/episode/bumper receipts may be only resource `{id, version}`; channel may be `{version}`. Prompt and publication projections are independent.
- Stored invalid grants are never normalized into valid authority. Revocation/deletion can clean up such records without issuing new rights.

## Testing

Worker tests use actual Miniflare D1/R2 and scoped fixtures. They cover a full external upload/review/publication workflow, denials, projected responses, token delegation, snapshots, storage references and migration preservation. Browser tests cover the owner interface and custom playback separately. Local verification uses synthetic media and does not imply production validation.
