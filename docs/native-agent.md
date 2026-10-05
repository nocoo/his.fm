# his.fm native local agent

his.fm uses a resident local Pi Durable coordinator. The website never starts a model or shell process in the browser. Read `/api/agent/openapi.json` for the current wire schemas and `/api/agent/capabilities` for domain permissions.

## Setup

The local runtime reads one private `~/.config/his.fm/config.json`. It contains model gateway settings, the local Jev gateway, speech provider settings/keys with a config revision, and separate `websites.local` / `websites.production` identities. Credentials never belong in prompts, source control, URLs or browser storage. The coordinator uses `gpt-6-astra` with high thinking; execution conversations use `gpt-6.1-sol` with Jev-selected thinking. Jev decisions are batched, limited to 16 KiB encoded requests and never shown in ordinary chat.

Run from the repository root:

```sh
npm run agent -- start --environment local
```

The agent connects outbound to `/api/agent/runtime/connect` using its Bearer token and `X-Hisfm-Station` header. The owner must explicitly bind that token and station through `POST /admin/api/agent/station`; first-connect does not acquire authority. Production requires a separate explicit token/binding and deployed runtime protocol. A Local/Prod browser switch never copies local credentials or local tasks into production.

## Local development and debugging

After configuring and enrolling the Local station, run:

```sh
npm run dev:all
npm run agent:debug
npm run agent:debug -- --command COMMAND_ID
```

`dev:all` starts the missing local website and coordinator, or reuses a healthy website and connected coordinator. It checks the exact service/version at `http://127.0.0.1:7056`; the studio is available at `https://hisfm.dev.hexly.ai`. Shutdown stops only processes it started. If a session crash leaves a disconnected coordinator alive but the website stopped, start `npm run dev` first and let that coordinator reconnect; inspect durable state before sending a replacement task.

`agent:debug` reads local SQLite state without starting models or changing tasks. Output includes command states, pending transport events/effects and tool counts/failures, not credentials or message/tool bodies. `--command` filters commands and inputs; tool statistics explicitly cover the last 1,000 tool results across all conversations. `--environment production` is an explicit read of that environment's local runtime records, not a production API operation.

For Node debugging, stop the existing Local coordinator after its tasks settle, then run `npm run agent:inspect`. The inspector binds only `127.0.0.1:37056`; keep it local because a debugger can access process secrets. Keep the website running separately with `npm run dev`. Routine tests use fake models and isolated state; live model verification is a separate authorized step.

## Delegation and completion

The coordinator owns the goal, plan, website effects and final acceptance. Executors receive outcomes, context and acceptance criteria, with autonomy to select native tools, scripts and verification methods within the current task. Writer/reviewer roles describe responsibilities rather than artificial tool restrictions. Each immutable assignment includes the current owner command and actual capabilities; a previous task's temporary limits remain scoped to that task.

Executors return immutable Markdown plus `done`, `blocked` or `needs_input`, supporting evidence and fixed required/met counts for quantified work. The coordinator reads results with `inspect_work` and accepts them with `finish_command`, citing evidence for every criterion and checking website receipts. A completed report alone does not complete the owner's goal. Requested independent review uses a separate reviewer. Routine reversible steps and recovery stay with the agents; scope changes, new external commitments and human-gated decisions return to the owner.

## Domain authority

Read `/api/agent/channel` and the production's `categoryProfile` before each creative assignment and recheck their revisions before canonical writes. Priority is channel policy, selected category prompt, episode intent, then sources; none can change factual truth or grant permissions. Read the production and its capabilities to get the current version, script version, stage and editable fields. Writer/reviewer reuse requires matching global and category prompt revisions.

Agent mutations use typed, idempotent operation frames on the enrolled runtime connection. Legacy direct machine mutations return `runtime_required`; GET discovery/context remains available. Operations have a stable ID and the exact command/production scope, optimistic version and connection lease. An uncertain response is reconciled through `/api/agent/runtime/receipts/:id`, not retried with a new ID.

Only the owner can approve, reopen, manage tokens/settings/channel policy, or confirm actual platform publication. The coordinator's editorial acceptance is not human approval. Audio generation additionally requires an explicitly requested task and an approved current transcript. Successful delivery never implies acoustic verification or platform publication.

## Ambient collaboration

The existing studio remains on the left, and the coordinator chat appears on the right. There is no enable/pause or page-awareness banner. Router and editor adapters publish typed page/entity/field state, the active draft revision and selection; they never collect screenshots, terminal screens, the complete DOM, credentials or unsent chat text.

The chat uses Basalt `Dock` and `Fab`, expanded initially. Collapse returns its width (or phone height) to the editor and reveals a floating launcher with the active task count. This is presentation only: the client, task execution, frozen contexts, chat input and message history remain mounted and connected. Escape within the panel collapses it; Escape in a role popover only dismisses that popover. Native Dock/Fab focus handling and a launcher return target keep keyboard navigation usable. Roles use one horizontally scrollable row of icon/status/task cards; full task text is available on demand without growing the chat header. The 44px header and inline send button reserve vertical space for messages.

Each user command freezes its page context. Changing pages after sending a command must not retarget it. Draft suggestions can update only the exact matching browser draft and do not Save. Canonical changes refresh clean fields; conflicts preserve local inputs for explicit resolution.

All textual results use Markdown. Executor conversations return results to the coordinator; they have no website API tool. They run local CLI/file tools without an OS sandbox. This is a trusted-local-user model, not a claim of credential isolation against arbitrary code.

The runtime stores conversation state and transport receipts locally. Browser closure does not stop it. Reconnects reconcile durable command IDs and operation receipts. Interrupted native commands are not blindly replayed. Model errors, incomplete work and unknown effects are reported as such.

## Native speech

Speech conversations receive only generate_speech and submit_result. The host launches a local bounded script against the immutable website job, then uploads PCM WAV under the active station generation and exact command. Provider credentials stay in the user-global config. Gemini and ElevenLabs eleven_v4 share the preview script and cache contract; see [audio](audio.md). Keep Falcon running for Jev assignment decisions.
