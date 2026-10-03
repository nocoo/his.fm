# Native agent implementation

The architecture diagrams in docs 01-03 are design references. This file distinguishes the executable local slice from remaining production/feature work; it is not a whole-system certification or a deployment claim.

## Running locally

1. Run `npm ci` through the approved registry, then `npm run dev` from the repository root.
2. Keep model/Jev/provider/site settings only in `~/.config/his.fm/config.json` (directory 0700, file 0600). Configure separate local/production website entries. Model keys are never returned by the website.
3. In the local owner session, create a machine token, then explicitly POST `/admin/api/agent/station` with `{tokenId,stationId,version:0}`. Rebinding requires the current station version and invalidates the prior connection generation. Store the one-time token in the matching private config entry.
4. Start `npm run agent -- start --environment local`. The process remains alive, connects outbound and resumes its own SQLite state. Stop with SIGINT/SIGTERM; do not start a second process for the same station.
5. Open `https://hisfm.dev.hexly.ai`, enter the local studio and use the right-hand coordinator chat. The top-right Local/Prod switch remains. Switching the website does not switch the daemon or copy tokens; production needs its own deployment and enrolled identity.

The currently selected coordinator is `gpt-6-astra/high`; executors are `gpt-6.1-sol` with Jev-selected low/medium/high. Jev batches plan and thinking questions, validates distributions and checks the full encoded request against a hard 16 KiB limit before transport. Oversize/invalid decisions fail visibly rather than silently changing models.

## Implemented

- Strict shared WSS schemas, explicit owner enrollment, one station generation with D1 fencing, local/Access browser authentication and same-origin guards.
- Durable commands, immutable command context, messages, statuses, pending draft proposals and operation receipts. Frames are acknowledged after persistence; snapshots and paginated history support browser recovery.
- Hibernatable AgentHub, application heartbeats, timeout/auth expiry, single-agent connection, bounded browser delivery window and `delivery.ack`.
- Pi Durable root coordinator, resident reviewers and task-scoped writers (same-production follow-up work can reuse a compatible writer through Jev; different productions cannot), explicit executor tool selection, native CLI/file tools, result documents, configured model gateways, instance lock and durable SQLite transport outbox.
- Type-safe coordinator website operations using existing production state rules, CAS and transactionally attached receipts. Human approvals and real platform publication cannot be performed by the agent. Audio still uses the existing cloud Workflow and requires explicit generation intent plus approved script.
- Ambient right sidebar; existing left editor and Save remain. Explicit page/field/draft/selection callbacks, no screenshot/DOM scraping or context-awareness controls. Exact proposals update draft without Save; dirty overlap remains explicit. Visited stages preserve text and undo; stable source IDs replace positional URLs.
- Local development-only production WS proxy holds Access credentials in the process, never the browser. Its upgrade path is exclusively routed to avoid double handling by the Cloudflare Vite plugin.
- Cancellation remains `cancelling` until local tasks have actually stopped. Audio dispatch responsibility survives a failed Workflow trigger through bounded AgentHub alarm retries of the original queued job.
- Root L1 commands include web, contracts and runtime with four 95% coverage floors. The staged gate remaps workspace links into the index snapshot rather than testing live workspace files.

## Local acceptance evidence

Real local model/gateway acceptance used an explicitly named temporary production, not the real first episode or production D1. The coordinator dispatched a writer, then an independent reviewer, accepted their Markdown and saved only the requested `intent`, advancing version 1 to 2. Model identities and task progress were observed through the real WebSocket. A Chrome test then requested a rewrite of an unsaved field: the draft changed in the editor while the canonical version remained 2. No paid audio, external publication or production mutation was performed. Restart verification retained the same root/resident reviewer, three completed commands, two effect receipts and an empty pending outbox; completed work was not regenerated.

Screenshots and safe task evidence stay ignored under `.local/agent-acceptance`. They are acceptance artifacts, not agent screen collection. Real runtime configuration/secrets stay outside the repository.

### Recovered multi-stage acceptance, 2026-10-04

The previous session's local research command survived with its native process and SQLite state intact after the local website stopped. Restarting only the website resumed its pending result handling without redispatching the command. The runtime retrieved 21 fixed-commit GitHub documents from three repositories (196,616 original bytes), created a manifest and Chinese source summaries, and used a separate reviewer to verify all entries and independently refetch five samples. The recovered session recomputed all 21 archived body hashes and excerpts, plus the five independently fetched hashes.

An oversized model-authored JSON patch was initially truncated and rejected before any website effect. The coordinator produced a smaller presentation of the same five source sections, obtained a second independent review and then saved successfully. The final local production advanced from version 1 to 2 with 21 new stable-ID sources, 22 total, preserving the original source and all other content fields. Readback matches the compact candidate exactly; one agent edit audit event was appended and all human approvals remain empty. The command completed with a successful operation receipt. This is recovered evidence for `8940067`, not proof of the subsequent generic prompt rewrite at `aa2c6d9`.

Recovery evidence is ignored under `.local/prompt-research`, including the final production readback, hash verification and content-field comparison. The runtime's source bodies and reviewer artifacts stay in its private local work directory. No production writes, paid audio or publication were performed. Large model-authored mutation payloads still require careful sizing; the private artifact-reference API remains an explicit boundary below.

## Explicit boundaries

- Production rollout is authorized for v2.1.0. The release deploys the matching runtime protocol; each production station must still be explicitly enrolled with a separate machine token. Production acceptance evidence is recorded after deployment, not inferred from local success.
- Context payloads are bounded and can reject excessively large draft/value pairs. The separate content-addressed chunk API in the larger design is not implemented yet; there is no silent truncation or screen fallback.
- Durable assignment results are local Pi documents; a separate private R2 artifact catalogue and deterministic Markdown-to-spoken-text approval UI from the full design are not part of this initial slice. Canonical manuscript writes must remain spoken prose-compatible Markdown until that renderer is implemented. Do not claim rich Markdown audio support or automatic binary-cover upload.
- The agent has full local CLI ability without OS sandbox isolation, but no permission to use other local credentials to bypass website human-only rules. This remains a trusted-local-user execution model.
- Model text/CLI results are not factual verification. Review results and human approvals remain separate; reconnect/heartbeat never certify completion.

## Current verification

The 2026-10-04 staged gate at `aa2c6d9` passes 266 web tests, 73 agent tests and 2 protocol tests. Coverage (statements/branches/functions/lines) is 98.63/96.39/99.46/99.56% for web, 98.80/97.03/97.67/99.17% for agent, and 100% throughout for contracts. Strict lint/typecheck pass. The Worker build exits successfully, with existing large-chunk and unavailable-Docker diagnostics. Frozen workspace installation and staged-gate rejection probes were exercised in the prior implementation session, not rerun as part of this recovery. This does not certify production deployment or paid TTS.

The recovered session reran all 25 Chrome agent/editor scenarios successfully, including chat grouping/copy/send, narrow/dark layouts, independent scrolling, draft preservation, source navigation and publication previews. Runtime regressions use real executor CLI tools with fake models to verify both multi-page loopback retrieval and non-research file processing by writers and reviewers; these deterministic checks establish tool wiring and task scope, not live-model reasoning quality.

## Verification commands

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run test:e2e
npm run build
node scripts/verify-gate.mjs
```

Tests use fake models/gateways, isolated SQLite/D1 and local WebSockets. Live model acceptance is a separate owner-authorized action, never part of routine unit tests or CI.

Final browser pass on 2026-10-03: the 37-scenario run passed 36 on its first attempt. The eight-theme asset-loading test hit a CDN image-load timeout, then passed an isolated rerun without code changes after the CDN responded 200. All nine native-agent browser scenarios passed in the full run. A preceding 36-scenario full run passed before the final chat-follow/authorization-renewal additions; do not describe the final run as 37/37 on its first attempt.
