# his.fm API onboarding

Use this document for scoped REST access. It is public documentation, not proof
of authentication. Base URL: `https://his.fm/api/agent`. Local development uses
the explicitly selected local origin; never reuse production tokens locally.

## 1. Obtain the smallest useful token

The owner opens `/admin/connections`, selects a preset, reviews individual grants
and issues a token. The default preset is read-only. Full control expands to an
explicit list and needs high-risk acknowledgement; it is not a wildcard.
A complete token is shown once. Save it in private local configuration, never in
a URL, browser storage, Git or a copied diagnostic transcript.

The resident runtime stores its website token in
`~/.config/his.fm/config.json`, under `websites.<environment>.token`. Other API
clients should use their own private secret storage. A website token is not a
Cloudflare Access credential. The API supports neither OAuth nor MCP/A2A.

Read the service manifest at `/api/agent`, OpenAPI at `/api/agent/openapi.json`
and the RFC catalog at `/.well-known/api-catalog`. Schemas contain no private
prompt bodies or provider keys. Each operation declares its required grants in
`x-required-scopes`; extra conditional grants are documented on the operation.

## 2. Verify identity and effective permissions

The following examples use environment placeholders. Do not paste a real token
into shell history or include expanded authorization headers in logs.

```sh
curl --fail-with-body "$HISFM_ORIGIN/api/agent/me" \
  -H "Authorization: Bearer $HISFM_TOKEN"
curl --fail-with-body "$HISFM_ORIGIN/api/agent/capabilities" \
  -H "Authorization: Bearer $HISFM_TOKEN"
```

`/me` returns `{actor}` with the agent's name, token ID, explicit scopes and expiry
(Unix milliseconds). `/capabilities` returns effective scopes, allowed submission
actions and limits. A public discovery response does not verify the token.
Expired, revoked and legacy unscoped tokens fail closed. A `403` means required
grants are absent, not that a station connection must be established.

A write grant never implies a read grant. Private prompts require `prompts:read`;
publication details require `publications:read`. Read projections also apply to
mutation responses. Do not overwrite omitted fields with guessed empty values.
Bumper uploads/updates without `bumpers:read` return only
`{bumper:{id,version}}`, not the saved media key, URL or other metadata.

## 3. Use REST for site business operations

No station enrollment or WebSocket is required for ordinary REST production,
category, episode, appearance, token or storage operations. Use only the exact
methods and bodies in OpenAPI. Do not write raw database fields, fabricate IDs,
approvals/versions or transport receipts.

For example, a `productions:read` token can list saved work:

```sh
curl --fail-with-body "$HISFM_ORIGIN/api/agent/productions" \
  -H "Authorization: Bearer $HISFM_TOKEN"
```

Before editing existing work, read its version and
`/productions/:id/capabilities`. Use only currently editable fields and authorized
stage actions. Submit/approve/reopen grants are independent: both `revise_*` and
`reopen_*` require `productions:reopen`, which approval does not imply. API approvals retain
an agent audit identity, never a fabricated human identity. A `409` requires a
fresh read and reassessment, not a blind retry.

Cover/audio assets use validated byte-upload endpoints and immutable R2 keys.
Keep covers clean and unframed. Publishing means recording an actual external
publication URL and updating the site snapshot; his.fm does not publish to
WeChat or Xiaoyuzhou for you. Correction/withdrawal uses explicit publication
operations, not raw episode snapshot editing.

AI/narration settings depend on the native host and are shared across Local and
Prod. Existing provider keys are never readable. Replacing or clearing a key is
write-only and requires `credentials:write`; supplying noncredential settings
separately requires `settings:write`. Send null to clear a saved key. A caller
without `settings:read` receives only the new configuration version after a save.
Full site control grants no arbitrary filesystem, deployment, Cloudflare or
external-platform access.

## 4. Delegate tasks only to the product runtime

Creative work belongs to the his.fm product coordinator. An agent-origin request
needs `tasks:submit`, `tasks:manage` and `prompts:read` to submit an outcome and
acceptance criteria to `POST /tasks`:

```json
{
  "id": "client-generated-stable-task-id",
  "text": "Inspect the selected material and report source-quality gaps; do not generate paid media or publish.",
  "context": null
}
```

A production-specific task carries the exact typed `PageContext` from the shared
contract and additionally needs `productions:read`. Never add a client principal
or another token's identity. Inspect `GET /tasks/:id` with `tasks:read`; cancel
with `POST /tasks/:id/cancel` and `tasks:cancel`. Bearer callers can inspect/cancel
only their own tasks unless also granted `tasks:manage` for all-site administration.
The coordinator and reusable executors retain shared history from other tasks.
`tasks:manage` authorizes that shared task/coordinator history; token-isolated
sessions are not implemented. A `tasks:submit`-only caller cannot invoke the
native coordinator. Fine-grained REST CRUD does not require this broad grant.
Audio/preview requests similarly need `audio:generate`, `tasks:manage` and
`prompts:read`; production audio also needs `productions:read` for task preparation.
Effects remain bounded by the originator's current grants
and the execution token's grants, including later revocation or expiry.

A queued receipt is not completion. A configured, enrolled, online native station
must execute the task or narration. Check terminal task state, artifacts and
successful website receipts. Do not substitute a manual generation/provider call
when the product pipeline is unavailable. Do not retry completed paid generation.

For editorial work, an authorized runtime reads the latest global and selected
category prompts. Priority is global prompt, category prompt, intent, sources.
Private policy does not grant permission or override factual truth.

## 5. Enroll only when running a native coordinator

General REST clients skip this step. A native coordinator needs a token including
`runtime:connect` and an explicit station binding managed by `runtime:manage`
(or the owner at the protected studio endpoint). Read the current binding version
before posting `{tokenId,stationId,version}` to `/api/agent/agent/station`.

The enrolled host upgrades `GET /api/agent/runtime/connect` using Bearer and
`X-Hisfm-Station`; never send secrets in URL query parameters. Runtime frame
schemas are published in OpenAPI. Stable operation IDs, expected versions,
heartbeat/expiry and durable receipts fence transport execution. A healthy station
is not replaced implicitly. Read `/runtime/receipts/:id` for an exact outcome;
`202` still means unknown/pending, not success.

Runtime station credentials do not expand the initiating caller's authority.
Task reads send both `X-Hisfm-Station` and the actual originating
`X-Hisfm-Command`; the server revalidates the originator and executor rather than
using the station token's grants alone. Do not send a fabricated command ID.
The resident coordinator's typed actions remain submission-only. Speech transport
is limited to the assigned job and does not expose provider credentials.

For full endpoint semantics and failure handling, read
[the site API reference](https://github.com/nocoo/his.fm/blob/main/docs/agent-api.md)
and [native runtime details](https://github.com/nocoo/his.fm/blob/main/docs/native-agent.md).
