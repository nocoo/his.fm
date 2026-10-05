# his.fm

## Architecture

- npm workspaces: `apps/web` owns the website, Worker, migrations and tests; `packages/agent` owns the resident Node/Pi Durable coordinator; `packages/contracts` owns strict shared realtime schemas. Root `package.json` is the only release version; root scripts delegate to `@his-fm/web`. Archives (`artwork`, `episodes`), docs and repository automation remain at root.
- The native agent implements the ambient workspace; docs 01-03 retain the broader design, while `docs/native-agent.md` and `docs/agent-implementation.md` record the executable contract and remaining boundaries. Its product contract is ambient: the coordinator appears by default, page context updates automatically, and there is no enable/pause control or persistent context-awareness banner. Keep sensitive fields excluded, explicit Save and human approvals intact, and distinguish cancelling a task from disabling the coordinator. Page awareness uses typed route/entity/field/edit-state events from application ViewModels, never screenshots, OCR, terminal capture, full DOM/accessibility-tree dumps or screen streaming. Reuse Eagle only for transport lifecycle; content is read by exact API/draft reference when needed.

- React 19 + Vite 8 + TypeScript 7.0.2, served by one Cloudflare Worker. Use the pinned project `cf` CLI and `apps/web/cloudflare.config.ts`; never use Wrangler for resource operations or deployment.
- Public views live in `apps/web/src/public/`. Admin views live in `apps/web/src/admin/` and use `@nocoo/basalt` 2.2.0 with standalone CSS and granular shell imports.
- Keep editable episode validation in `apps/web/src/shared/episode.ts`, business logic in `model.ts` / `service.ts`, and D1 / Access / R2 logic in `apps/web/worker/`.
- Agent discovery lives at `/api/agent`, `/.well-known/api-catalog` and `/llms.txt`; OpenAPI and public onboarding must remain synchronized with shared validators and protected controllers. Native runtime website tokens live only in `~/.config/his.fm/config.json`; public discovery never proves authentication.
- Production contracts live in `apps/web/src/shared/production.ts`; human and agent routes share controllers but never share approval privileges. All writes require optimistic versions. Published episode snapshots are readonly through legacy CRUD.
- The owner editor uses five freely navigable URL stages: brief, script, assets, review, publish. Navigation is read-only; completion and reopening use the shared state machine. Keep one visible stage; visited stage panels stay mounted to preserve drafts and undo. The left editor island and right coordinator message list scroll independently.
- The coordinator uses Basalt Dock/Fab, expanded by default. Collapsing only hides the panel and returns space to the editor; keep its drafts, messages, ambient context, connection and running tasks alive. Role cards stay in one horizontally scrollable row, with full task text in a Basalt Popover. Keep the header and composer compact.
- Brief sources use a compact list and URL-addressable `?step=brief&source=<id>` detail pages (persistent source identity). Keep the brief draft mounted during source navigation; returning preserves inputs, while explicit brief saving persists them together. Do not render every source editor in the overview.
- Keep `.admin-content-island` positioned for its absolute descendants. Stage changes reset only this island's scroll; `scrollIntoView` can scroll the overflow-hidden shell and hide the breadcrumb header.
- Long review text uses Markdown and the private `/admin/fonts/jinkai/` subsets from xray; shell controls retain Basalt typography.
- Long Markdown fields share `apps/web/src/admin/markdown/MarkdownEditor.tsx`; keep source text and undo history intact across preview switches. Short plain-text fields retain Basalt inputs. See `docs/markdown-editing.md`.
- Keep admin headers compact: titles and primary actions share a row where space permits, omit redundant subtitles and card headings, and wrap controls only when required on mobile. WeChat preview must render the exact sanitized HTML used for copying.
- Secondary-page back buttons belong to the left of the title and subtitle group, using an accessible arrow control rather than a right-side action.
- Audio generation defaults to narration only. Bumpers are opt-in; voice/style overrides are immutable per-job snapshots. Owner-only short previews reuse content-addressed R2 WAVs; Gemini and ElevenLabs credentials live only in the native user config.
- `apps/web/worker/entry.ts` exports the Worker and `AgentHub`; TTS runs in the native speech script through a dedicated speech conversation, never in a Worker Workflow. D1 job and production state transitions must remain atomic and idempotent; completed audio must never regress after replay.
- Settings pages are Brand Appearance (`/admin/appearance`), AI Settings (`/admin/ai`), Connections (`/admin/connections`), Narration (`/admin/narration`) and Bumpers (`/admin/bumpers`). `/admin/voices` compares the same Chinese script across providers. AI GET responses expose key presence and allowlisted model settings only; incoming replacement keys are write-only and stored atomically in the private user config.
- Public routes: `/`, `/episodes`, `/episodes/:slug`, `/about`. Admin routes and APIs share `/admin`; `/login` is the public entry badge.
- Eight public themes share the Open Interval identity in `apps/web/src/brand/`. `/admin/appearance` owns the versioned D1 selection; `?theme=` is a non-mutating public preview. Images use immutable R2 keys; fonts ship as fingerprinted same-origin Vite assets. See `docs/appearance.md`.
- Generated, uploaded and stored covers must be clean originals without text, logos, borders or overlays. Only the studio's finished-cover download composes the independent brand frame; never upload that composite as a source or rewrite published originals.
- Production Access issuer and audience are checked cryptographically in the Worker. Never trust an email header as authentication.
- Preserve the internal editorial policy in README. Public content and episode materials are Chinese; code and technical documentation are English.

- Global prompt is private owner-editable Markdown in D1 `channel_profile`, initialized once from `apps/web/worker/channel-default.md`. `/admin/channel` uses the shared CodeMirror 6 Markdown editor with Basalt controls and safe previews. Agents can only GET `/api/agent/channel`.
- Editorial priority is global prompt, then selected category prompt, then episode intent, then sources; this never changes factual truth or grants permissions. Every production prompt and native assignment reads the latest channel and category profiles. Keep prompt bodies out of public discovery and client bundles; profile updates do not implicitly rewrite productions or invalidate approvals.
- `/admin/categories` manages stable-ID categories with names, a curated Lucide icon set, Basalt tag colors and private Markdown prompts. Episode selectors and public filters read category metadata from D1 rather than a hardcoded list. Only the owner may write categories, all updates/deletes use optimistic versions, and referenced categories cannot be deleted. Changing a production's selected category reopens its brief; changing the category prompt affects subsequent work without silently revoking existing approvals. Executor reuse is scoped by both global and category prompt revisions.

## Local development

- `npm run dev` migrates and seeds local D1 once, then starts Vite on loopback port 7056.
- User-facing URL: `https://hisfm.dev.hexly.ai`. Caddy proxies to `127.0.0.1:7056` and permits only loopback clients.
- Reserved ports: integration 17056, browser 27056, inspector 37056. See nmem `hisfm-local-ports` before changing them.
- `apps/web/cloudflare.config.ts` selects local bindings and `ENVIRONMENT=local` only in `development` mode. All other modes use production settings. Local D1 uses `00000000-0000-4000-8000-000000007056`; Run local CLI commands from `apps/web` with `--local --persist-to .cloudflare/state` to share Vite state. Local login requires this flag, an allowed hostname and same-origin requests. It creates an expiring HttpOnly session; production never enables it.
- Mock content exists only in `apps/web/scripts/seed-local.mjs`; schema migrations contain no episode content. Never seed mock records into remote D1. Preserve existing local edits and deletions across restarts.
- The owner explicitly authorized importing the real episode 001 into both databases. `apps/web/scripts/import-example.mjs --local|--remote` imports existing materials without approvals or publication; this is separate from mock seeding.
- The first episode has a complete manuscript, not a finished recording. Preview episodes have no audio URL; do not fabricate playable media.

## Commands

```sh
npm run dev
npm run dev:all
npm run agent:debug
npm run agent:inspect
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
npm run cf:typegen
npm run agent -- start --environment local
node scripts/verify-gate.mjs
```

Install through an allowed registry on this machine. Never retry blocked `registry.npmjs.org`. `npm install` runs `prepare`; `npm run prepare` reinstalls Husky if needed.

## Quality and Git

- Every subsequent deployment increments only the patch version: `X.Y.Z` → `X.Y.(Z+1)`. Change the major or minor version only when the owner explicitly requests it.
- Features, database migrations, authentication changes, diff size and elapsed time must not trigger automatic major/minor bumps. This project rule overrides generic release-skill version selection.
- L1 checks meaningful Worker, shared contracts, agent runtime, model and service behavior with Vitest across all workspaces. All four coverage floors are 95%; React views and generated platform declarations are excluded from unit coverage.
- Biome uses its maintained recommended preset and rejects warnings. TypeScript is strict.
- Husky runs checks against the Git index snapshot, without changing the working tree or restaging fixes. Stage explicit paths, then commit through the normal hook.
- Audit evidence belongs in nmem, using `6dq-audit-github.com-nocoo-his.fm-l1`; no full 6DQ certification is implied by L1.
- Keep `.env`, `.dev.vars`, generated audio/video, local Cloudflare state, test screenshots and coverage out of Git. Image-generation originals and prompts are intentionally archived in `artwork/`.
- Record corrected mistakes in `Retrospective.md`. Preserve other agents' edits; only the coordinator stages and commits.

## Cloudflare

- Production domain: `his.fm`; Worker, D1 and R2 names: `his-fm`.
- R2 CDN: `https://f.no.mt`. Voice references use `reference/voices/*.wav`; generated media stays ignored.
- Owner-only R2 resource management lives at `/admin/storage` and `/admin/api/storage`. Scan through every cursor; failed/partial scans cannot enable cleanup. Revalidate D1 references and R2 versions before deleting, preserve `images/`, `reference/`, active audio-job prefixes/snapshot bumpers and all uploads younger than 24 hours. Never use production media as destructive test fixtures. Cleanup does not purge CDN caches or compress media.
- D1 ID: `66f7e201-22a8-450d-838d-ecbc382afbc6`.
- The existing Access application protects `his.fm/admin`; descendant paths inherit its policy unless a more specific application overrides them.
- `run_worker_first` covers `/admin`, `/admin/*`, `/api/*`, `/media/*`, `/.well-known/api-catalog` and `/llms.txt`.
- Deploy through published GitHub Releases and pinned `nocoo/base-ci`; use `cf` Build Output in `apps/web/.cloudflare/output/v0` with `cf deploy --prebuilt --mode production`. Install from the repository root with its single lockfile. The shared workflow invokes `scripts/deploy.mjs`, which verifies the web workspace's exact cf version and runs migrations/deployment from `apps/web`. Keep Wrangler out of both direct and transitive dependencies. Verify `/api/live` against the exact release version and revision.
- Active hero assets use immutable `images/hero-retina-20260926-*.webp` keys; original artwork and derivative provenance live in `artwork/manifest.json`. Mobile `picture` crops place the subject at 61.8%; `sizes` must account for the full rendered image under `object-fit: cover`, including its height. Episode images use `images/episode-01.webp` through `episode-03.webp`. `/media/*` serves configured R2 objects; the owner manages the CDN domain.

See `docs/architecture.md` and `docs/operations.md` for contracts and operating steps.

## Content execution policy

- Proactively use the his.fm product agent for all editorial and content work: research, fact checking, briefs, scripts, revisions, summaries, translations, cover artwork, narration, voice previews/comparisons, bumpers and content artifacts. Submit the owner's outcome and acceptance criteria through the studio or its authenticated task API; the native coordinator delegates to the appropriate specialist conversations.
- The development agent owns product implementation, diagnosis and acceptance, not an alternate content-production path. Do not bypass the product agent by directly calling generation providers, running content scripts or manually writing final content into the website. Repository code, tests and technical documentation remain development work.
- Treat real content tasks as end-to-end product exercises. Observe task state, inspect artifacts and successful website receipts, and verify the delivered result. If a capability is missing or the pipeline fails, reproduce the problem, repair the product within scope, add a focused regression check and rerun through the product agent. Do not silently substitute manual generation or report a workaround as a repaired pipeline; report external blockers and request any additional authorization needed.
- Preserve exact task inputs and environment, reuse completed artifacts and resume or explicitly retry failed work without duplicate paid generation. This execution policy does not grant new spending, production writes, credentials access, approval or publication privileges; existing owner authorization and human-only gates still apply.

## Native agent

- Node 22.22+ Pi Durable 1.0 local runtime: `npm run agent -- start --environment local|production`. One process lock/storage namespace per website origin and station. Model/Jev/website credentials live in one private `~/.config/his.fm/config.json`; never print, stage or forward them to the browser.
- Coordinator uses `gpt-6-astra/high`; executors use `gpt-6.1-sol`, with low/medium/high chosen by Jev. Matching high thinking is allowed by the owner's current model selection. Batch reuse/lifetime and thinking questions; bound the complete encoded Jev request to 16 KiB and at most 12 questions, no full transcripts.
- Propagate explicit network proxy configuration to native executors and speech subprocesses, and include credential-free proxy endpoints/status plus loopback bypass guidance in every assignment. Tell specialist conversations when direct provider access requires the configured proxy; never keep this operational fact only in the development agent's context. Do not expose proxy credentials, disable TLS verification or change system networking without authorization.
- AgentHub is a hibernatable DO with an outbound machine WSS connection, typed messages, heartbeat/auth expiry, a fenced D1 station lease and durable receipts. Register a token/station explicitly through the authenticated same-origin owner API before connecting. Legacy direct machine mutations are rejected; typed operations reuse the production controllers.
- Browser context comes only from explicit route/editor callbacks. Preserve frozen command contexts independently of the latest live pointer. Exact proposals apply to local draft without Save; stale proposals never replace user text. Never expose Jev decisions or raw model reasoning in routine chat.
- Only the coordinator has general website tools. Dedicated speech conversations have scoped `generate_speech` and `submit_result` tools; the host script owns provider credentials and job-scoped upload. Other executors have native CodingTools without an OS sandbox; not injecting secrets is a logical boundary, not isolation from arbitrary same-user CLI code. Human approval, token/settings changes and publication stay owner-only.
- Delegate outcomes and acceptance criteria with executor autonomy over tools and methods. Immutable assignments carry the current owner command and native capabilities; request-specific limits belong to that command, not later tasks. Inspect structured outcomes and evidence before `finish_command`; a report alone does not establish success, and website effects require successful receipts.
- Local/Prod switches reset the browser environment, never copy runtime tokens or move queued tasks. Prod runtime requires separately configured token/enrollment and deployed protocol. Local verification must not write production or generate paid audio.
