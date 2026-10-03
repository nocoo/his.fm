# his.fm native local agent

his.fm uses a resident local Pi Durable coordinator. The website never starts a model or shell process in the browser. Read `/api/agent/openapi.json` for the current wire schemas and `/api/agent/capabilities` for domain permissions.

## Setup

The local runtime reads one private `~/.config/his.fm/config.json`. It contains model gateway settings, the local Jev gateway, and separate `websites.local` / `websites.production` identities. Credentials never belong in prompts, source control, URLs or browser storage. The coordinator uses `gpt-6-astra` with high thinking; execution conversations use `gpt-6.1-sol` with Jev-selected thinking. Jev decisions are batched, limited to 16 KiB encoded requests and never shown in ordinary chat.

Run from the repository root:

```sh
npm run agent -- start --environment local
```

The agent connects outbound to `/api/agent/runtime/connect` using its Bearer token and `X-Hisfm-Station` header. The owner must explicitly bind that token and station through `POST /admin/api/agent/station`; first-connect does not acquire authority. Production requires a separate explicit token/binding and deployed runtime protocol. A Local/Prod browser switch never copies local credentials or local tasks into production.

## Domain authority

Read `/api/agent/channel` before each creative assignment and recheck its version before canonical writes. Priority is channel policy, episode intent, then sources; none can change factual truth or grant permissions. Read the production and its capabilities to get the current version, script version, stage and editable fields.

Agent mutations use typed, idempotent operation frames on the enrolled runtime connection. Legacy direct machine mutations return `runtime_required`; GET discovery/context remains available. Operations have a stable ID and the exact command/production scope, optimistic version and connection lease. An uncertain response is reconciled through `/api/agent/runtime/receipts/:id`, not retried with a new ID.

Only the owner can approve, reopen, manage tokens/settings/channel policy, or confirm actual platform publication. The coordinator's editorial acceptance is not human approval. Audio generation additionally requires an explicitly requested task and an approved current transcript. Successful delivery never implies acoustic verification or platform publication.

## Ambient collaboration

The existing studio remains on the left, and the coordinator chat appears on the right. There is no enable/pause or page-awareness banner. Router and editor adapters publish typed page/entity/field state, the active draft revision and selection; they never collect screenshots, terminal screens, the complete DOM, credentials or unsent chat text.

Each user command freezes its page context. Changing pages after sending a command must not retarget it. Draft suggestions can update only the exact matching browser draft and do not Save. Canonical changes refresh clean fields; conflicts preserve local inputs for explicit resolution.

All textual results use Markdown. Executor conversations return results to the coordinator; they have no website API tool. They run local CLI/file tools without an OS sandbox. This is a trusted-local-user model, not a claim of credential isolation against arbitrary code.

The runtime stores conversation state and transport receipts locally. Browser closure does not stop it. Reconnects reconcile durable command IDs and operation receipts. Interrupted native commands are not blindly replayed. Model errors, incomplete work and unknown effects are reported as such.
