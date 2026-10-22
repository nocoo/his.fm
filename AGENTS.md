# his.fm

## Architecture

- npm workspaces: `apps/web` owns the website, Worker, migrations and tests; `packages/contracts` owns shared scope, prompt and WAV validation. Root `package.json` is the sole release version. Archives, docs and repository automation remain at root.
- his.fm is a podcast CMS. Content and media generation happen outside the site, with external clients using scoped REST tokens. Do not reintroduce an embedded agent, coordinator sidebar, task/runtime transport, provider settings or generation endpoints.
- React 19, Vite 8 and TypeScript 7.0.2 are served by one Cloudflare Worker. Use the pinned project `cf` CLI and `apps/web/cloudflare.config.ts`; never Wrangler for resources or deployment.
- Public views live in `apps/web/src/public/`; admin views in `apps/web/src/admin/` use `@nocoo/basalt` 3.2.0 with standalone CSS and granular shell imports. Preserve Open Interval public identity and Basalt admin tokens.
- Studio navigation sections use native `SidebarGroup` disclosures. Let Basalt own their spacing and the single navigation gutter; collapsed rails render the same destinations as centered `SidebarIconItem` rows without custom group wrappers.
- Keep editable episode validation in `apps/web/src/shared/episode.ts`, production contracts in `apps/web/src/shared/production.ts`, view logic in models/services and D1/Access/R2 logic in `apps/web/worker/`.
- `/admin` is the unified programme library, defaulting to a cover grid with a list alternative. Deduplicate linked episodes only by `sourceProductionId`, never by slug or title. Retain standalone episode CRUD at `/admin/episodes/:id`.
- Studio breadcrumbs derive from the current pathname and query in `admin/navigation.model.ts`, ending with one nonlinked current item. Keep ancestors as real router links and detail selections in the address bar so refresh and browser history work. On narrow screens, scroll only the breadcrumb strip, never the shell.
- Production details use four freely navigable sections: `?section=metadata|manuscript|assets|publication`. Navigation is read-only; explicit saves, reviews and reopening use the shared state machine. Keep visited editors mounted for drafts and undo.
- Sources have persistent IDs and `?source=<id>` detail views. Keep the brief mounted during source navigation; explicit saving persists all source edits together. Do not render every source editor in the overview.
- Keep `.admin-content-island` positioned for absolute descendants. Section navigation resets only its scroll; do not scroll the overflow-hidden shell or hide its header.
- Long Markdown fields share `admin/markdown/MarkdownEditor.tsx`. Preserve source and undo across previews. Short plain text uses Basalt inputs; reviews use safe Markdown and private `/admin/fonts/jinkai/` subsets. See `docs/markdown-editing.md`.
- Keep headers compact with actions alongside titles; secondary back controls belong left of the title. WeChat preview must render exactly the sanitized HTML copied to the clipboard.
- `src/components/AudioPlayer.tsx` is the shared custom public/admin player. Hidden native audio handles playback; visible controls use Basalt, support keyboard/pointer/touch seeking and prevent cover drag. Keep single-instance playback and source-reset behavior; no native audio controls.
- Production audio is manually uploaded as 24 kHz mono PCM16 WAV or MP3 (`audio/mpeg`), at most 3,600 seconds (WAV up to 172,865,536 bytes; MP3 up to 144,065,536 bytes). Require an approved current script, valid versions and `productions:write` plus `storage:write`. Asset detach preserves immutable media; no fabricated generation jobs. Bumpers remain WAV-only and are a standalone media library, not automatic mixing.
- Public routes are `/`, `/episodes`, `/episodes/:categoryId/:slug`, `/about`; legacy `/episodes/:slug` redirects to the category path. `/login` is the studio entry. Settings are Appearance, Connections, Prompts, Categories, Bumpers and Storage. Narration is ordinary prompt-slot text, not a provider setting.
- Public HTML uses the shared React tree with request-scoped published data and client hydration/revalidation. Keep content readable without JavaScript and omit drafts, transcripts and audit fields from bootstrap data. See `docs/seo.md` for feed launch requirements; never infer the owner's email or personal identity.
- Keep public CSS in the static entry before the jitless-configured deferred React bootstrap. Production HTML receives fresh CSP nonces after the named `PublicContent` cache, never cached per-user responses or nonce-bearing templates.
- Eight themes share the Open Interval identity in `src/brand/`. Appearance is versioned D1 state; `?theme=` previews without mutation. Fonts are fingerprinted same-origin assets. See `docs/appearance.md`.
- The appearance catalogue takes design copy and named palettes from `docs/design/index.html`, with current canonical IDs. Every theme shows a horizontally scrollable strip of the latest four covered entries from the unified `programLibrary`, including standalone episodes and deduplicating linked snapshots exactly as the library does. Reuse `FramedCover` with each entry's existing artwork and metadata; never require a production upload or substitute design samples. Only theme selection uses URL state; there is no single-programme selector. Preview never requests PNG exports, saves appearance or publishes content.
- The canonical ID is `his.fm ()`: the trailing open parentheses allude to `func()`. Preserve the exact outlined wordmark and symbol in `src/brand/identity.svg`, never typed substitutes or theme-specific fonts. `BrandLockup` owns the public/studio top-left headers, appearance specimen and theme-card IDs: an equally tall square symbol, a proportional gap (8px per 116px wordmark), vertically centered and same-color (theme dark primary `ink` on light backgrounds, white on dark). Wordmark widths are 116px for public headers/specimens, 92px for the studio rail and 140px for theme cards, with proportional shrinking in narrow cards. Treat the parentheses as the same typographic scale, never a smaller companion icon. Keep card slogan/title sizes uniform across all eight themes. Theme favicons use the same centered white symbol on each theme's dark primary background; previews follow the preview theme, otherwise the saved theme. Do not extend this normalization to archived studies, decorative marks, cover/share artwork or installed-app icons without authorization.
- Generated/uploaded/stored covers must be clean originals without text, logos, borders or overlays. Public/admin previews and authenticated `cover.png` downloads share the selected theme's composition, real metadata and centered artwork window. Export is a read-only 1600-square PNG with 4 MiB/4MP source guards; never upload the composite as a source or rewrite published originals. See `docs/appearance.md` and `docs/api-onboarding.md`.

## Authorization and content

- Public API discovery stays at `/api/agent`, `/.well-known/api-catalog`, `/llms.txt` and read-only `/api/card` (protocol v1 in `docs/card-api.md`). Keep OpenAPI and `docs/api-onboarding.md` synchronized with validators/controllers. Discovery proves neither authentication nor authority.
- Human and bearer routes share controllers. Finite explicit grants govern external clients; no wildcard, default authority or identity spoofing. Full-scope tokens can manage all site business modules, but not infrastructure/deployment or external-platform posting. See `docs/scoped-api.md`.
- Read is independent of write. Project prompts/publications separately; write-only production/episode/bumper responses return minimal IDs/versions. Approval and reopening are distinct grants. Token delegation cannot exceed issuer scopes/expiry; revocation cascades; deletion requires prior revocation and preserves ancestry.
- All existing-record content writes use optimistic versions. Linked episode snapshots are protected from standalone CRUD; only display `featured` has a separate versioned PATCH. Publication/correction/withdrawal atomically updates snapshots and audit; revisions preserve the last published content.
- Access JWT signatures, issuer, audience and expiry are verified in the Worker. Never trust an email header. Human mutations require same-origin requests; bearer REST does not require a station or browser Origin.
- `/admin/channel` owns channel/category prompt-slot tables with independent collection versions and per-slot audit/version. UI edits local drafts and explicitly saves whole tables; API also supports individual CRUD under `prompts:read`/`prompts:write`. Category append/override merges enabled slots by stable ID; disabled category slots do not mask channel. `skills` contains names only. See `docs/prompts.md`.
- Migration 0023 is schema-only. Runtime GET `.../prompt-slots/migration/dry-run` never writes; separate POST `.../migration/apply` fences collection/legacy versions and atomically backs up original values before initialization. Never execute production apply without separate authority. Old whole-prompt fields are read-only stored values before apply, then enabled-local-slot Markdown projections. Preserve original SQL fields, migration backups and Worker-only defaults; no browser default bodies.
- Editorial priority is global prompt, selected category prompt, episode intent, then sources. External clients read current guidance before creative work. Prompts never grant permissions or alter factual truth; edits do not silently rewrite productions or approvals.
- Category metadata uses stable IDs, curated Lucide icons and Basalt tag colors. Prompt reads/writes require prompt scopes separately; partial metadata writes preserve omitted prompts. Referenced categories cannot be deleted. Changing a production's category follows brief-reopening rules.
- Preserve the internal editorial policy in [docs/editorial-policy.md](docs/editorial-policy.md). Public content and episode materials are Chinese; code and technical documentation are English.
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
- Large R2 test fixtures use `apps/web/tests/worker/r2-fixtures.ts` and its local fixture Worker: raw byte arguments to binding proxies synchronously serialize as Base64/JSON, while arbitrary streams lack R2's required length. Read stored bodies as streams, consume responses promptly and compare bytes with native `Buffer.equals`, not deep equality.
- Biome uses its maintained recommended preset and rejects warnings. TypeScript is strict.
- Husky runs checks against the Git index snapshot, without changing the working tree or restaging fixes. Stage explicit paths, then commit through the normal hook.
- Audit evidence belongs in nmem, using `6dq-audit-github.com-nocoo-his.fm-l1`; no full 6DQ certification is implied by L1.
- Keep `.env`, `.dev.vars`, generated audio/video, local Cloudflare state, test screenshots and coverage out of Git. Image-generation originals and prompts are intentionally archived in `artwork/`.
- Record corrected mistakes in `Retrospective.md`. Preserve other agents' edits; only the coordinator stages and commits.

## Cloudflare

- Production domain: `his.fm`; Worker, D1 and R2 names: `his-fm`.
- Bind `www.his.fm` to the same Worker and redirect HTTP/www to HTTPS apex before routing. Enable native Workers Cache only on `PublicContent`, not the gateway; successful content/SEO/appearance writes purge its cache. Miniflare cannot establish edge HIT/purge behavior.
- R2 CDN: `https://f.no.mt`. Voice references use `reference/voices/*.mp3`; the manifest and fixed transcript live in `apps/web/src/shared/data/`. Preview generation remains external; MAI references use only `MAI-Voice-2.1`, never Flash. Generated media stays ignored.
- R2 resource management lives at `/admin/storage`, `/admin/api/storage` and scope-gated `/api/agent/storage`. Scan through every cursor; failed/partial scans cannot enable cleanup. Revalidate D1 references and R2 versions before deleting, preserve `images/`, `reference/`, archived media provenance and all uploads younger than 24 hours. Never use production media as destructive test fixtures. Cleanup does not purge CDN caches or compress media.
- D1 ID: `66f7e201-22a8-450d-838d-ecbc382afbc6`.
- The existing Access application protects `his.fm/admin`; descendant paths inherit its policy unless a more specific application overrides them.
- All requests run Worker-first with no asset SPA fallback. The Worker owns public SSR/404s and explicit studio shells; local Vite module requests must pass through to assets.
- Deploy through published GitHub Releases and pinned `nocoo/base-ci`; use `cf` Build Output in `apps/web/.cloudflare/output/v0` with `cf deploy --prebuilt --mode production`. Install from the repository root with its single lockfile. The shared workflow invokes `scripts/deploy.mjs`, which verifies the web workspace's exact cf version and runs migrations/deployment from `apps/web`. Keep Wrangler out of both direct and transitive dependencies. Verify `/api/live` against the exact release version and revision.
- Active hero assets use immutable `images/hero-retina-20260926-*.webp` keys; original artwork and derivative provenance live in `artwork/manifest.json`. Mobile `picture` crops place the subject at 61.8%; `sizes` must account for the full rendered image under `object-fit: cover`, including its height. Episode images use `images/episode-01.webp` through `episode-03.webp`. `/media/*` serves configured R2 objects; the owner manages the CDN domain.
- Public R2 covers use fixed, versioned, theme-aware WebP thumbnails through native `IMAGES`, matching the shared centered artwork window. Stream sources; do not reuse WASM PNG-export guards or alter originals, RSS/OG artwork or composed downloads. Keep current published-record checks and trusted R2 source resolution before transformation or redirect.

See `docs/architecture.md` and `docs/operations.md` for contracts and operating steps.
