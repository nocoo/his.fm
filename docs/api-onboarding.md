# his.fm external API onboarding

his.fm is a podcast content-management site. External clients create text, artwork and recordings outside the site, then use scoped REST to manage content. There is no embedded agent, native station, task queue, generation endpoint, MCP or A2A service.

## Connect

- API base: `https://his.fm/api/agent`.
- Public discovery: `/api/agent`, `/.well-known/api-catalog`, `/llms.txt`.
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
| Prompts | `prompts:read`, `prompts:write` |
| Appearance | `appearance:read`, `appearance:write` |
| Bumpers | `bumpers:read`, `bumpers:write`, `bumpers:delete` |
| Media storage | `storage:read`, `storage:write`, `storage:delete` |
| Tokens | `tokens:read`, `tokens:issue`, `tokens:revoke`, `tokens:delete` |

There is no wildcard. Reader/editor/owner presets expand to explicit grants; the owner preset selects all current grants. Approval does not imply reopening; writes do not imply reads. No grant bypasses version checks, linked snapshot protection, media validation or reference-safe cleanup.

## Editorial preparation

Read `GET /channel` with `prompts:read` before creative work. It returns current global policy and the editable prompt bundle, including `narration`. Read the selected category or a production's private prompt bundle as authorized. Priority is **global prompt -> category prompt -> episode intent -> sources**; facts and permissions are not overridden by prose.

Saved workflow/voice/compaction prompt keys are templates for external use, not executable site features. Internal editorial policy should guide writing without being recited as a public slogan. Sources must be verified externally; the website stores references and does not fetch arbitrary URLs.

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
- `PUT /productions/:id/assets/audio?version=N`: raw `audio/wav` or `audio/mpeg`, Content-Length required, positive duration up to 3,600 seconds. WAV must be 24 kHz mono PCM16 (max 172,865,536 bytes). MP3 must be valid MPEG Layer III (max 144,065,536 bytes; 96–128 kbps mono recommended). The server derives duration; no multipart or duration metadata. It requires an approved current script.
- `POST /productions/:id/assets/audio/bind`: JSON `{version,key}` attaches WAV or MP3 already uploaded to R2, with the same limits, approval and reopening rules. Allowlisted keys are `uploads/<uuid>.{wav|mp3}` or `productions/<id>/audio-<scriptVersion>-<uuid>.{wav|mp3}` for this production and current script. Staging sources are copied and retained; cleanup is a separate authorized action. Uploading out-of-band with the project `cf` CLI requires independently authorized infrastructure access; website tokens cannot upload through Cloudflare's API.
- Both uploads and `DELETE /productions/:id/assets/{cover|audio}?version=N` require `productions:write` plus `storage:write` and the applicable stage policy. Changing reviewed assets requires `productions:reopen`. Detach retains immutable R2 bytes.
- `POST /storage` uploads safe raster/PCM WAV up to 25 MiB to a server-chosen immutable key, without attaching it to a production.
- `POST /bumpers?name=...&position=intro|outro` accepts PCM WAV up to 30 seconds/3 MiB with `bumpers:write`. Metadata updates use PUT plus version; deletion uses `?version=N` and retains physical media.

```sh
curl --fail-with-body -X PUT \
  "https://his.fm/api/agent/productions/$PRODUCTION_ID/assets/audio?version=$VERSION" \
  -H "Authorization: Bearer $HISFM_TOKEN" \
  -H 'Content-Type: audio/wav' --data-binary @finished.wav
# MP3 uploads use Content-Type: audio/mpeg and keys ending in .mp3 when binding out-of-band.
```

Fetch the new version after every successful mutation. Never blindly retry a body after a conflict.

## Publication and episodes

`POST /productions/:id/publications` records `{version, platform, url, publishedAt}`. Platforms are `wechat` and `xiaoyuzhou`, with matching HTTPS hostnames and an actual non-future time. Current final approval/assets are required. This records publication; it does not post to the external platform.

`PATCH /productions/:id/publications/:platform` corrects the record using the same complete body, including the matching platform. `DELETE .../:platform?version=N` withdraws it with `publications:delete`. Events remain in the audit. The last withdrawal makes the linked website episode draft; it does not expose an in-progress revision. `GET /productions/:id/publications` requires `publications:read`.

Standalone `/episodes` supports POST/GET and `/:id` GET/PUT/DELETE. PUT includes version; DELETE uses `?version=N`. Publishing/changing published standalone content additionally requires `episodes:publish`. Linked production snapshots reject standalone content writes/deletion. `PATCH /episodes/:id` permits only `{version, featured}` display metadata.

Production briefs and standalone episode bodies accept an ordered `mentions` array (at most 50 items). Each item is `{name, description, url?}`: `name` and `description` are required strings; `description` is a single-sentence explanation; `url` is optional and must be `http` or `https` when present. Published snapshots copy `mentions` to the public episode. Public `/api/episodes` responses include `mentions` but never full transcripts.

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

- Categories: GET/POST `/categories`, GET/PUT/DELETE `/categories/:id`. Private reads need `categories:read`; prompts additionally need `prompts:read`. PUT is partial plus version and preserves omitted prompt. Optional `nextId` renames the stable ID and updates episode/production references in one transaction. Changing a prompt additionally needs `prompts:write`; referenced categories cannot be deleted.
- Channel: GET/PUT `/channel`; PUT accepts version plus content and/or the complete known prompt bundle. Writes need `prompts:write`; write-only responses return only version.
- Appearance: GET/PUT `/appearance`; PUT uses current version and a known theme ID.
- Storage: GET `/storage?cursor=...` must follow all cursors. GET/HEAD `/storage/object?key=...` streams single byte ranges. DELETE `/storage/object?key=...&version=...` or POST `/storage/cleanup` with `{items:[{key,version}]}` needs `storage:delete` and reports per-object results, not unconditional deletion.

Cleanup protects current references, retained media provenance, `images/`, `reference/` and uploads younger than 24 hours. It cannot prove an object has no external users or atomically coordinate arbitrary R2 overwrites with D1; avoid concurrent reference changes. Deletion does not purge CDN caches.

## Delegation and response privacy

`POST /agent-tokens` requires `tokens:issue` and `{name, expiresInDays, scopes}`: 1-365 days, explicit nonempty unique grants. A machine issuer cannot grant beyond its own scopes or expiry; a live DB fence rechecks this at insertion. The raw token is shown once.

`POST /agent-tokens/:id/revoke` requires `tokens:revoke` and revokes descendants. `DELETE /agent-tokens/:id` needs `tokens:delete` and prior revocation, preserving a tombstone/ancestry. Machines cannot manage targets outside their grants. GET requires `tokens:read` and never reveals hashes or raw values. Unknown/empty grants cannot authenticate; invalid stored metadata may be shown only to facilitate cleanup.

Write-only production, episode and bumper calls acknowledge `{id, version}` inside their resource envelope. Publication arrays/events and category prompt bodies are projected by their independent read grants. Do not assume write responses contain existing private data.

Errors use HTTP status and `{error, code, documentation}`: 401 invalid/expired/revoked token, 403 missing authority, 409 changed version or invalid business state, 413/415 invalid media size/type. Read the error and latest authorized state; do not escalate grants, forge a version or retry destructive writes automatically.
