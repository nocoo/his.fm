# his.fm

## Architecture

- npm workspaces: `apps/web` owns the website, Worker, migrations and tests; `packages/contracts` owns shared scope, prompt and WAV validation. Root `package.json` is the sole release version. Archives, docs and repository automation remain at root.
- his.fm is a podcast CMS. Content and media generation happen outside the site, with external clients using scoped REST tokens. Do not reintroduce an embedded agent, coordinator sidebar, task/runtime transport, provider settings or generation endpoints.
- React 19, Vite 8 and TypeScript 7.0.2 are served by one Cloudflare Worker. Use the pinned project `cf` CLI and `apps/web/cloudflare.config.ts`; never Wrangler for resources or deployment.
- Public views live in `apps/web/src/public/`; admin views in `apps/web/src/admin/` use `@nocoo/basalt` 3.1.0 with standalone CSS and granular shell imports. Preserve Open Interval public identity and Basalt admin tokens.
- Keep editable episode validation in `apps/web/src/shared/episode.ts`, production contracts in `apps/web/src/shared/production.ts`, view logic in models/services and D1/Access/R2 logic in `apps/web/worker/`.
- `/admin` is the unified programme library, defaulting to a cover grid with a list alternative. Deduplicate linked episodes only by `sourceProductionId`, never by slug or title. Retain standalone episode CRUD at `/admin/episodes/:id`.
- Production details use four freely navigable sections: `?section=metadata|manuscript|assets|publication`. Navigation is read-only; explicit saves, reviews and reopening use the shared state machine. Keep visited editors mounted for drafts and undo.
- Sources have persistent IDs and `?source=<id>` detail views. Keep the brief mounted during source navigation; explicit saving persists all source edits together. Do not render every source editor in the overview.
- Keep `.admin-content-island` positioned for absolute descendants. Section navigation resets only its scroll; do not scroll the overflow-hidden shell or hide its header.
- Long Markdown fields share `admin/markdown/MarkdownEditor.tsx`. Preserve source and undo across previews. Short plain text uses Basalt inputs; reviews use safe Markdown and private `/admin/fonts/jinkai/` subsets. See `docs/markdown-editing.md`.
- Keep headers compact with actions alongside titles; secondary back controls belong left of the title. WeChat preview must render exactly the sanitized HTML copied to the clipboard.
- `src/components/AudioPlayer.tsx` is the shared custom public/admin player. Hidden native audio handles playback; visible controls use Basalt, support keyboard/pointer/touch seeking and prevent cover drag. Keep single-instance playback and source-reset behavior; no native audio controls.
- Audio is manually uploaded 24 kHz mono PCM16 WAV, at most 1,800 seconds/86,465,536 bytes. Require an approved current script, valid versions and `productions:write` plus `storage:write`. Asset detach preserves immutable media; no fabricated generation jobs. Bumpers are a standalone media library, not automatic mixing.
- Public routes are `/`, `/episodes`, `/episodes/:slug`, `/about`; `/login` is the studio entry. Settings are Appearance, Connections, Prompts, Categories, Bumpers and Storage. Narration is ordinary `channel.prompts.narration` text.
- Eight themes share the Open Interval identity in `src/brand/`. Appearance is versioned D1 state; `?theme=` previews without mutation. Fonts are fingerprinted same-origin assets. See `docs/appearance.md`.
- Generated/uploaded/stored covers must be clean originals without text, logos, borders or overlays. Only the finished-cover download composes the independent brand frame; never upload the composite as a source or rewrite published originals.

## Authorization and content

- Public API discovery stays at `/api/agent`, `/.well-known/api-catalog` and `/llms.txt`. Keep OpenAPI and `docs/api-onboarding.md` synchronized with validators/controllers. Discovery proves neither authentication nor authority.
- Human and bearer routes share controllers. Finite explicit grants govern external clients; no wildcard, default authority or identity spoofing. Full-scope tokens can manage all site business modules, but not infrastructure/deployment or external-platform posting. See `docs/scoped-api.md`.
- Read is independent of write. Project prompts/publications separately; write-only production/episode/bumper responses return minimal IDs/versions. Approval and reopening are distinct grants. Token delegation cannot exceed issuer scopes/expiry; revocation cascades; deletion requires prior revocation and preserves ancestry.
- All existing-record content writes use optimistic versions. Linked episode snapshots are protected from standalone CRUD; only display `featured` has a separate versioned PATCH. Publication/correction/withdrawal atomically updates snapshots and audit; revisions preserve the last published content.
- Access JWT signatures, issuer, audience and expiry are verified in the Worker. Never trust an email header. Human mutations require same-origin requests; bearer REST does not require a station or browser Origin.
- `/admin/channel` owns global editorial content and 17 saved named prompts under one D1 version. Existing 16 keys/bodies are preserved; narration is appended. New defaults are Worker-only in `worker/prompt-defaults.ts`, never imported into browser code. Categories retain independent prompt versions. See `docs/prompts.md`.
- Editorial priority is global prompt, selected category prompt, episode intent, then sources. External clients read current guidance before creative work. Prompts never grant permissions or alter factual truth; edits do not silently rewrite productions or approvals.
- Category metadata uses stable IDs, curated Lucide icons and Basalt tag colors. Prompt reads/writes require prompt scopes separately; partial metadata writes preserve omitted prompts. Referenced categories cannot be deleted. Changing a production's category follows brief-reopening rules.
- Preserve the internal editorial policy in README. Public content and episode materials are Chinese; code and technical documentation are English.
- Development work and tests do not authorize paid generation, private credential access, production content writes or publishing. External content execution needs its own explicit authorization; never infer it from a token's technical capability.
- Retirement removes operational tables and source, not saved content, audit or immutable R2 bytes. Preserve allowlisted media provenance, saved prompts and remaining business grants. Invalid token JSON shapes must stay invalid, never normalize into authority. Do not inspect/delete private external-client configuration or ignored local state as part of code cleanup.

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
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
npm run cf:typegen
node scripts/verify-gate.mjs
```

Install through an allowed registry; never retry blocked `registry.npmjs.org`. `npm install` runs `prepare`; `npm run prepare` reinstalls Husky if needed.

## Quality and Git

- Every subsequent deployment increments only the patch version: `X.Y.Z` → `X.Y.(Z+1)`. Change the major or minor version only when the owner explicitly requests it.
- Features, database migrations, authentication changes, diff size and elapsed time must not trigger automatic major/minor bumps. This project rule overrides generic release-skill version selection.
- L1 checks meaningful Worker, shared contracts, model and service behavior with Vitest across all workspaces. All four coverage floors are 95%; React views and generated platform declarations are excluded from unit coverage.
- The web suite caps Vitest at four workers to bound concurrent isolated Miniflare runtimes. Preserve test isolation, deadlines and coverage thresholds when tuning concurrency.
- Biome uses its maintained recommended preset and rejects warnings. TypeScript is strict.
- Husky runs checks against the Git index snapshot, without changing the working tree or restaging fixes. Stage explicit paths, then commit through the normal hook.
- Audit evidence belongs in nmem, using `6dq-audit-github.com-nocoo-his.fm-l1`; no full 6DQ certification is implied by L1.
- Keep `.env`, `.dev.vars`, generated audio/video, local Cloudflare state, test screenshots and coverage out of Git. Image-generation originals and prompts are intentionally archived in `artwork/`.
- Record corrected mistakes in `Retrospective.md`. Preserve other agents' edits; only the coordinator stages and commits.

## Cloudflare

- Production domain: `his.fm`; Worker, D1 and R2 names: `his-fm`.
- R2 CDN: `https://f.no.mt`. Voice references use `reference/voices/*.wav`; generated media stays ignored.
- R2 resource management lives at `/admin/storage`, `/admin/api/storage` and scope-gated `/api/agent/storage`. Scan through every cursor; failed/partial scans cannot enable cleanup. Revalidate D1 references and R2 versions before deleting, preserve `images/`, `reference/`, archived media provenance and all uploads younger than 24 hours. Never use production media as destructive test fixtures. Cleanup does not purge CDN caches or compress media.
- D1 ID: `66f7e201-22a8-450d-838d-ecbc382afbc6`.
- The existing Access application protects `his.fm/admin`; descendant paths inherit its policy unless a more specific application overrides them.
- `run_worker_first` covers `/admin`, `/admin/*`, `/api/*`, `/media/*`, `/.well-known/api-catalog` and `/llms.txt`.
- Deploy through published GitHub Releases and pinned `nocoo/base-ci`; use `cf` Build Output in `apps/web/.cloudflare/output/v0` with `cf deploy --prebuilt --mode production`. Install from the repository root with its single lockfile. The shared workflow invokes `scripts/deploy.mjs`, which verifies the web workspace's exact cf version and runs migrations/deployment from `apps/web`. Keep Wrangler out of both direct and transitive dependencies. Verify `/api/live` against the exact release version and revision.
- Active hero assets use immutable `images/hero-retina-20260926-*.webp` keys; original artwork and derivative provenance live in `artwork/manifest.json`. Mobile `picture` crops place the subject at 61.8%; `sizes` must account for the full rendered image under `object-fit: cover`, including its height. Episode images use `images/episode-01.webp` through `episode-03.webp`. `/media/*` serves configured R2 objects; the owner manages the CDN domain.

See `docs/architecture.md` and `docs/operations.md` for contracts and operating steps.
