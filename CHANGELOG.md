# Changelog

All notable changes to his.fm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use the owner’s patch-only deployment policy in `AGENTS.md`, with the authoritative version in `package.json`.

## 2.7.2 - 2026-10-18

This release includes the artwork edge-cache changes listed under 2.7.1.
The 2.7.1 tag and GitHub Release were created, but failed main CI prevented
deployment; those changes ship with 2.7.2 instead.

### Fixed

- Compare artwork bytes with native Buffer equality in integration tests, avoiding synchronous deep traversal that can outlive Miniflare's idle sockets on CI runners. Preserve full byte validation without retries, skipped tests or reduced quality gates.
- Validate actual bytes in edge and R2 cache-hit assertions instead of applying object equality to raw ArrayBuffers.

## 2.7.1 - 2026-10-18

### Fixed

- Cache versioned podcast and share artwork at the Cloudflare edge by the full URL, skipping R2 on repeat hits while retaining current publication/version checks, immutable headers, HEAD and conditional 304 responses.
- Expose `x-hisfm-art: edge-hit | r2-hit | rendered` and synchronize agent-facing cache verification instructions, including pregenerated first reads and asynchronous edge warming.
- Keep plain and stale-version redirects `no-store` so withdrawal and artwork changes remain immediately visible to the Worker.

## 2.7.0 - 2026-10-18

The owner explicitly approved this minor release, overriding the patch-only deployment policy.

### Added

- Preview episode and homepage social cards in the studio across eight platforms, using actual public SEO metadata and honest saved-image availability without publishing or saving edits.
- Cache generated square podcast art and landscape share images in R2 with input-versioned URLs, immutable responses, HEAD, ETag and Last-Modified. Pregenerate after studio or Agent API cover uploads, metadata and action edits, publication/correction, category changes and square-art theme changes; retain lazy generation on cache misses and protect current generated objects during storage cleanup.

### Changed

- Top-align episode artwork and playback with the episode content, and improve the compact mobile episode-page layout.
- Anchor the landscape `share.jpg` crop at the original artwork's horizontal center and 40% vertical focus, with bounded image intermediates and unchanged clean originals.
- Remove the redundant top-level studio sidebar creation entry while preserving new-programme creation from the programme library.

## 2.6.0 - 2026-10-18

The owner explicitly approved this minor release, overriding the patch-only deployment policy.

### Added

- Add theme-independent Stillwood brand images at `/brand/share.jpg` (1200 x 630) and `/brand/podcast.jpg` (3000 x 3000) as the default sharing and podcast artwork.
- Add public artwork endpoints for published episodes: `/episodes/{id}/art.jpg` renders the current theme's framed square composition at 1400 x 1400 by default; `/episodes/{id}/share.jpg` renders a 1200 x 630 image with theme-independent Stillwood branding. Preserve clean original artwork and saved publication snapshots.

### Changed

- Use each episode's `share.jpg` for `og:image` and `twitter:image`, unless an explicit episode social-image override is saved.
- Point RSS item `itunes:image` to each episode's `art.jpg` in both site and category feeds. Fall back to the brand square podcast image when the channel has no configured podcast cover.

## 2.5.3 - 2026-10-18

### Added

- Emit the configured podcast author homepage (`podcastAuthorUrl`) as `<atom:author>` (atom:name + atom:uri) in the site and category RSS channels, and include the author `url` in podcast episode page JSON-LD (#68).

### Fixed

- Drain Miniflare workerd raster test responses before unrelated async image work, and enable `MINIFLARE_ASSERT_BODIES_CONSUMED` so full gates catch unconsumed response bodies.

## 2.5.2 - 2026-10-18

### Added

- Add an optional HTTPS author homepage to versioned SEO settings, author JSON-LD and public author links. Keep identity/contact values owner-controlled and document the confirmed fields, channel artwork, sharing artwork and reviewed name correction in `docs/seo-content-checklist.md`.
- Expose per-production SEO overrides in metadata and the scoped API. Require explicit reviewed publication/correction to change the public snapshot; preserve omitted snapshot SEO and clear overrides only with an explicit empty object.

### Fixed

- Serve public R2 covers through finite, versioned, theme-aware WebP thumbnails with responsive image sizes. Match each approved centered artwork window, support valid large/nonsquare originals through native Images, and preserve original bytes, RSS/OG images and composed PNG exports.
- Cache reusable public HTML templates and artwork derivatives in the named Workers Cache entrypoint, parallelize SSR reads and purge after successful relevant writes. Keep the gateway/private APIs uncached, strip credentials before cache access and apply fresh CSP nonces after reading templates.
- Prevent Zod's eval capability probe from violating CSP without enabling unsafe-eval. Keep public CSS in the static entry for no-JavaScript rendering, and apply shell headers without mutating fetched asset headers.
- Bind `www.his.fm` to the Worker so HTTP/www requests use the canonical HTTPS redirect.
- Extend v2.5.1 storage reference protection to saved mention and production SEO references. Preserve the expanded URL/path extractor, report SEO references distinctly, fail closed when any reference-query batch is unsuccessful, and revalidate references before deletion.

### Deployment Notes

- No D1 migrations or dependency changes. Deployment adds the native `IMAGES` binding and the cache-enabled `PublicContent` entrypoint; the default gateway remains cache-disabled.
- Directory readiness requires an owner-supplied genuine 3000 x 3000 RGB JPEG/PNG channel cover, a separate 1200 x 630 sharing image, and saved identity/contact settings. Deployment does not populate production editorial settings or prove podcast-directory acceptance.
- Local workerd/browser checks do not establish native edge cache HIT/purge behavior or a Lighthouse score. Verify real DNS/TLS, Images output and cache headers after deployment; do not change production content solely for a purge test.

## 2.5.1 - 2026-10-17

### Fixed

- Count every image URL stored in site, category and episode SEO settings as a storage reference during inventory scans and orphan cleanup, including absolute `f.no.mt` CDN URLs and `/images` or `/media` path forms.

## 2.5.0 - 2026-10-17

The owner explicitly requested this minor release (Y+1). The comparison baseline is the deployed release v2.4.9.

### Added

- Server-render public page bodies with the shared React route tree, request-scoped published data, client hydration and revalidation. Keep headings, summaries, show notes and episode links readable without JavaScript; exclude drafts, transcripts and audit fields from public bootstrap data.
- Add authenticated episode and production `cover.png` endpoints and studio download controls. Return one 1600 x 1600 PNG using the selected theme, saved metadata and clean original without mutating content or media. Share artwork windows, title wrapping and typography with public/admin previews; enforce read scopes, saved-version checks, trusted sources, static-image limits and bounded rendering.
- Add dedicated podcast cover/contact settings and an explicit Person/Organization author choice, plus a web manifest and Apple touch icon using the existing identity.

### Changed

- Restore all eight themes' hero proportions, typography, decoration and cover compositions with self-hosted fonts. Preserve real programme metadata, centered artwork crops, clean source images and the unified public navigation identity.
- Align studio theme-card content and preview/download controls across desktop, tablet, phone and light/dark modes. Reduce Interval cover titles and align its footer metadata; add a fine outer border to Tidal Hours covers.

### Fixed

- Remove light seams around artwork, balance cover title spacing and keep primary-color hover actions inside their artwork. Preserve the requested raster font family when multiple static glyph families are loaded.
- Resolve RSS enclosure lengths from trusted R2 metadata, omit missing/non-audio/unsupported enclosures, normalize historical fractional durations, emit boolean explicit values and valid iTunes taxonomy, and escape description markup safely. Preserve omitted SEO fields in partial updates instead of resetting them to defaults.
- Return real public 404s, normalize trailing slashes before SSR, and revalidate public data after studio navigation. Add HSTS/CSP headers, responsive hero preloads and appropriate asset caching without claiming a new Lighthouse score.

### Deployment Notes

- No new D1 migrations relative to v2.4.9. Public routing now runs Worker-first without asset SPA fallback; deployment includes the Worker and its frame/font assets.
- Podcast directory submission still requires an owner-approved contact email and a verified 1400-3000px RGB JPEG/PNG cover. Finished-cover exports accept static sources up to 4 MiB and 4MP; local workerd validation is not certification of every production CPU or memory workload.

## 2.4.9 - 2026-10-17

### Changed

- Restored Worker coverage gates for `categories`, `episodes` and `production` while keeping other SEO shell modules excluded; client navigation now upserts `og:type`, canonical and Twitter tags instead of only updating existing nodes.
- Login and not-found client routes continue to clear stale JSON-LD before rendering shell pages.

### Fixed

- Regression tests lock RSS enclosure `type`/`length`, catalogue `category` URL sync, unified legacy slug resolution, version-guarded category alias deletes, and the absence of legacy category-id **301** redirects on feeds or catalogue queries.

## 2.4.8 - 2026-10-17

### Added

- Site-wide and per-resource **SEO** defaults with admin editing, Worker-rendered HTML head tags, JSON-LD, `robots.txt`, `sitemap.xml`, category RSS feeds, and client-side head updates on navigation.

### Changed

- Category renames preserve the full **alias chain** and reclaim alias IDs when renaming back; SEO overrides persist across renames.
- Legacy `/episodes/<slug>` resolves to the **earliest** published match; managed head tags are **replaced** (not duplicated); client navigation clears server JSON-LD; absolute audio URLs skip CDN prefixing; `/episodes?category=` filters the catalogue.

## 2.4.7 - 2026-10-17

### Added

- Public episode URLs at `/episodes/<category>/<slug>` with Worker-first routing, legacy `/episodes/<slug>` **301** redirects, and `category_id_aliases` so renamed category IDs keep old paths working.
- Unique `(category, slug)` on episodes; public and API lookup resolve category plus slug.

### Changed

- Migration **0016** ranks episode numbers jointly across episodes and unlinked productions in each category; linked productions sync from snapshots only when categories still match.
- Migration **0020** adds `episode_number_claims` with composite holder keys so a published snapshot and its production can claim different categories; productions and standalone episodes reserve `(category, episode_number)` in one transaction.
- Production and episode writes update claims only after the main row succeeds; published snapshots keep episode claims when draft production numbers diverge; category renames move claims and deleting an empty category clears inbound aliases.
- Legacy `/episodes/<slug>` redirects prefer published episodes even when the slug matches reserved SPA segments.
- Production create allocates episode numbers atomically against claims and `productions(category, episode_number)` with retry on conflict; manual duplicate numbers return **409**.
- OpenAPI episode create marks `episodeNumber` optional; admin brief mentions use `safeParse`; new production form no longer remounts when the suggested number loads; episode detail pages reset the meta description on leave.

## 2.4.6 - 2026-10-17

### Added

- Episode **mentions** on briefs and programmes: `{name, description, url?}` (max 50), edited in admin, copied to published snapshots, rendered on public pages, RSS show notes, JSON-LD `Thing` entries, and public `/api/episodes` JSON.
- Per-category **episode numbers** with studio display `栏目名 EP.NN`, unique `(category, episode_number)`, and optional explicit assignment on create.

### Changed

- Public catalogue, pages, RSS, JSON-LD, `llms.txt`, and `/api/episodes` no longer expose full **transcripts**; admin and Agent APIs retain them.

## 2.4.5 - 2026-10-17

### Changed

- Move **音色预览** from the bottom of **品牌外观** to its own studio sidebar entry at `/admin/voice-preview`, keeping Gemini and ElevenLabs reference playback unchanged.

## 2.4.4 - 2026-10-17

### Added

- Let owners rename category stable IDs through `PUT /api/agent/categories/:id` with optional `nextId`, updating episode foreign keys and production `category` fields atomically. The studio category editor exposes the ID field beside display metadata.
- Restore **音色预览** under **品牌外观**, pairing Gemini and ElevenLabs voices with the fixed comparison transcript. Play existing `reference/voices/*.wav` samples in-admin; show placeholders when ElevenLabs reference files are not uploaded yet (no in-site generation).

### Changed

- Seed new environments with category `manager-notes` (**主理人手札**) and `learning` (**每日手冲**). Existing deployments rename IDs and display names through the category API; episode copy and bumper text are edited through episode, production and bumper APIs.

## 2.4.3 - 2026-10-16

### Changed

- Polish the admin studio: denser cover and audio cards with progressive disclosure, aligned asset grids, quieter replace/unlink controls, and metadata behind compact info popovers. Increase shell padding to match sibling Basalt apps, remove container-level focus rings while keeping control focus styles, and show the signed-in author avatar from lizheng.blog on the sidebar footer.

### Added

- Delete standalone programmes and deletable productions from the library detail headers, reusing existing scoped delete APIs and publication/snapshot guards.

## 2.4.2 - 2026-10-16

### Added

- Accept `audio/mpeg` for production narration `PUT` uploads and `POST …/assets/audio/bind`, with MP3 magic/frame validation, duration from Xing/Info gapless metadata (including LAME/Lavc/Lavf encoder delay and padding at tag+21..23 when present) or a streaming MPEG-1/2/2.5 Layer III frame scan, immutable `productions/{id}/audio-<scriptVersion>-<uuid>.mp3` keys, and capabilities/OpenAPI/docs updates. Bumpers and generic storage uploads remain WAV-focused where unchanged.

## 2.4.1 - 2026-10-16

### Fixed

- Raise production narration limits to one hour (3600 seconds / 172,865,536 bytes) for manual `PUT` uploads, out-of-band R2 bind, brief `targetDurationSeconds`, and final-asset validation so ~38-minute WAV files bind successfully.

## 2.4.0 - 2026-10-16

The owner explicitly requested this minor release (Y+1). The comparison baseline is the deployed release v2.3.3, merged before release preparation.

### Changed

- Make his.fm a podcast CMS for external content-generation clients. Remove the embedded native agent, coordinator transport, task queues, provider settings and audio-generation endpoints without reintroducing compatibility paths. Retain scoped REST discovery, shared business controllers and manually uploaded media.
- Unify the programme library with cover/list views, explicit linked-snapshot deduplication, freely navigable production sections and stable-ID source detail pages. Preserve drafts and Markdown undo across navigation, compact studio controls and the shared accessible custom audio player.
- Organize token management by status and require revocation before list deletion, preserving delegation ancestry and authorization tombstones. Keep saved editorial prompts, including ordinary narration guidance, independent of retired execution code.
- Upgrade Basalt to 3.1.0, React/React DOM to 19.3.1, Lucide React to 1.57.0, Playwright to 1.64.1, and Vitest/coverage-v8 to 5.0.5. Replace Motion with native CSS and IntersectionObserver reveals, preserving reduced-motion and keyboard behavior. Remove the unused TypeSafe SDK and TypeBox with the retired runtime.

### Fixed

- Preserve v2.3.3's out-of-band R2 audio binding while applying the shared 1,800-second/86,465,536-byte WAV limits, explicit grants, script approval, reopening and optimistic-version checks. Retain original staging media on successful or failed binding and delete only newly created failed copies. Reject non-POST binding methods rather than falling through to audio detachment.
- Match browser assertions to rendered Basalt geometry and public Markdown semantics. Wait for the destination episode form during lazy navigation instead of filling the previous screen's identically labelled field. Bound isolated Vitest runtime concurrency without reducing coverage floors or timeouts.

### Validation

- Local unit coverage runs 278 web tests and 7 shared-contract tests; all four workspace coverage metrics exceed 95%. Strict type checking, warning-free lint, production build and staged-index checks are required before publication.
- Browser acceptance covers 57 scenarios across public pages, studio workflows, Markdown, themes, tokens, storage and custom playback. Local verification uses synthetic media and does not authorize production content changes or paid generation.

### Deployment Notes

- Apply migrations 0014 and 0015 before deploying: add token deletion tombstones, retain allowlisted media provenance, append missing narration guidance and retire operational runtime/generation tables. Preserve programme content, assets, approvals, publication audit and R2 bytes.
- The owner authorized permanent deletion of the production AgentHub Durable Object namespace. A production-only export tombstone performs the deletion; local state and unrelated remote resources remain untouched. Record a D1 Time Travel recovery bookmark before cutover. It does not restore deleted Durable Object data; recovery after this lifecycle transition uses a forward CMS deployment, not a Worker-only rollback.

## 2.3.3 - 2026-10-16

### Added

- Agent API `POST /productions/:id/assets/audio/bind` attaches mono 24 kHz PCM16 WAV files already uploaded to the `his-fm` R2 bucket (via the project `cf` CLI), for narration larger than the Worker `PUT` body limit. Staging keys under `uploads/` copy into immutable `productions/{id}/audio-<scriptVersion>-<uuid>.wav` keys; direct production keys bind in place. Duration limit is 3600 seconds.

## 2.3.2 - 2026-10-15

### Fixed

- Public episode 本期摘要 and 逐字稿 now render Markdown links through shared `ReadingText` and `formatReading` (HTTPS-only), so show-notes hyperlinks work instead of escaped plain text.

## 2.3.1 - 2026-10-15

### Added

- Allow `platform: "site"` publication confirmation so a ready production can promote its public episode snapshot without a WeChat or Xiaoyuzhou URL. External platforms still require validated HTTPS links.

## 2.3.0 - 2026-10-15

The owner explicitly requested this minor release (Y+1). It includes the unpublished 2.2.1 work; the comparison baseline is the deployed release v2.2.0.

### Added

- Add 39 explicit API scopes with reader, editor, coordinator and owner presets, individual grant selection and acknowledgement of high-risk permissions. Ordinary REST clients can use scoped bearer tokens without Frogie or station enrollment.
- Expose scoped production, episode, category, prompt, appearance, bumper, storage, settings, token and task operations through shared business controllers. Keep discovery, OpenAPI, capability projections and REST-first onboarding aligned with the implemented validators.
- Add validated immutable manual WAV uploads, cover/audio detachment, publication correction and withdrawal, and independent episode featured metadata. Publication changes preserve append-only audit events and versioned episode snapshots.
- Add stable-ID editorial categories with private prompts and a centralized Prompts page for global policy, sixteen named runtime/stage prompts, category prompts and narration style.

### Security

- Require explicit nonempty token grants; delegated tokens cannot exceed the issuer's current scopes or expiration. Fence issuance against concurrent revocation and revoke descendants with their parent.
- Keep approval and reopening separate. Scope reads independently from writes, return minimal acknowledgements to write-only callers, and omit unauthorized prompts, publications and other private metadata.
- Carry the original task principal through runtime operations and speech jobs. Revalidate live origin/executor grants, expiry, station leases and captured authority at reads and atomic writes; fail closed for legacy records without an authorized principal.
- Authorize native command reads, cached preparation, recovery and shared-history compaction before model use. Agent-origin native tasks require tasks:submit, tasks:manage and prompts:read, plus productions:read for production context; audio also requires audio:generate. Shared coordinator/resident history is not isolated by token.

### Changed

- Move role definitions, all sixteen prompt defaults, channel policy and narration style into Frogie Markdown. Preserve existing D1 edits, category settings and immutable task/job snapshots.
- Run resident conversations through `@frogie/core/host`, which owns Pi Durable integration, context compaction and execution diagnostics. his.fm retains Jev scheduling, website tools, approvals, speech execution and transport receipts.
- Install the compiled Frogie 0.5.0 package from the tracked `vendor/` artifact, independently of a neighboring checkout. Require Node 26 or newer.
- Store new execution state in `frogie.sqlite`, preserving `pi.sqlite` and existing transport history. Initial adoption checks for unfinished legacy commands and pending events; read-only debugging reports the new Host's tool diagnostics.
- Merge dependency maintenance updates, including Vite 8.3.4, Vitest 5.0.4, Playwright 1.64.0 and Zod 4.6.7, while retaining the compiled Frogie integration. Pin shared CI and release workflows to base-ci v2026.9.

### Fixed

- Isolate native runtime effect identities, recover durable context compaction and report safe speech failure reasons without exposing provider credentials.
- Preserve workspace-local dependency resolution in staged quality snapshots and verify that unstaged helper changes cannot alter the committed gate.
- Prevent the studio's light loading flash and improve compact prompt controls and tablet layouts.

### Validation

- The merged dependency graph passes 487 unit tests across web (348), native agent (126) and contracts (13); all four coverage metrics exceed 95% in every workspace. Strict lint, type checking, production build and staged-gate rejection probes pass.
- Two focused mocked browser scenarios verify token presets, explicit grants and high-risk acknowledgement before the dependency merge. Full browser acceptance and authenticated production business workflows are not claimed by this release.

### Deployment Notes

- Apply migrations 0010 through 0013 before deploying the Worker: categories and episode references, centralized prompts, token scopes, and episode versions. No mock episodes, local media or private native configuration are copied into production.
- Migration 0012 revokes every existing website token. Issue explicit replacement grants and enroll the updated production coordinator again before native tasks or audio can run.
- Native histories remain shared, so tasks:manage is a high-trust grant, not a per-token isolation boundary. Plain REST access does not require this grant unless invoking those native workflows.
- Credentials remain write-only; immutable IDs, audit records and receipts are not arbitrary CRUD fields. Publication APIs maintain website publication records and do not publish to external platforms. Authenticated production acceptance awaits a newly issued owner token; no paid generation is included in release verification.

## 2.2.0 - 2026-10-05

The owner explicitly requested this minor release (Y+1).

### Added

- Split studio configuration into Brand Appearance, AI Settings, Connections, Narration and Bumpers. Keep provider credentials in the native user's private config; authenticated settings responses expose only key presence and allowlisted model parameters.
- Add ElevenLabs `eleven_v4` alongside Gemini `gemini-3.8-flash-tts`. Dedicated speech conversations run a bounded local Node script, checkpoint content-addressed WAVs and return scoped website upload receipts.
- Group same-script voice comparisons into Charon/George, Aoede/Sarah and Orus/Liam pairs, with Gemini on the left and ElevenLabs on the right. Add provider SVG marks, distinct theme-aware card tints and aligned card, player and action rows.
- Add named intro/outro WAV libraries with independent per-production selection; narration still defaults to no bumpers.
- Add local combined development, runtime inspection and debugging commands.

### Changed

- Remove Worker-side TTS calls, the Gemini secret binding and AudioWorkflow. The website retains approval checks, immutable job snapshots, fenced uploads, transactional attachment and optional WAV composition; the enrolled native coordinator executes speech.
- Require immutable owner-scoped assignments, inspected execution evidence and successful website receipts before the coordinator accepts delegated outcomes. Preserve exact command context across recovery and prevent prior task restrictions from leaking into unrelated assignments.
- Keep the coordinator in a compact, collapsible Basalt Dock with persistent drafts/connections, horizontal role cards, safe copy actions and a message composer that grows from three to five lines before scrolling.

### Fixed

- Merge optimistic chat messages with their canonical echoes instead of rendering duplicate bubbles.
- Restore Basalt control typography and enforce accessible provider-card contrast in both themes.
- Make paired provider cards equal-height without forcing fixed content heights or breaking mobile grouping.

### Validation

- The staged gate runs all web, native-agent and shared-contract tests with all four coverage floors at 95%, plus warning-free lint and strict type checking.
- Focused Chrome checks cover equal-height cards, desktop/tablet/mobile pairing, SVG marks, contrast, playback coordination, failed preview recovery and fixed comparison style without modifying studio defaults.
- Real local native conversations delivered three new ElevenLabs benchmark samples (19.04 s, 19.68 s and 19.60 s). Their fixed script/style matches verified Gemini reference WAVs (16.76 s, 18.60 s and 19.72 s); browser decoding and stored durations agree.

### Deployment Notes

- Migration `0009_native_speech.sql` creates speech-job and bumper tables before the new Worker is deployed. No mock content or local media is imported into production.
- Production audio requires an independently enrolled, connected Prod coordinator with the current native runtime and private provider config. Local tokens, jobs and example WAVs are not copied into production by this release.
- The owner's configured ElevenLabs library voice requires a paid account; the comparison voices were verified separately. Key presence does not guarantee voice access. Gemini API connectivity was unavailable during the final comparison run, so existing verified references were reused rather than reported as newly generated.

## 2.1.0 - 2026-10-03

The owner explicitly requested this minor release (Y+1).

### Added

- Add a resident local Pi Durable coordinator with `gpt-6-astra/high`, `gpt-6.1-sol` execution conversations, and local Jev batched routing bounded to 16 KiB. Persist conversations, task results, command IDs and transport receipts across restart.
- Integrate ambient coordinator chat beside the existing studio editor. Typed page/field/draft/selection context replaces manual prompt copying; no screen capture, DOM scraping, activation control or page-awareness banner is introduced.
- Add an authenticated AgentHub Durable Object with outbound machine WebSockets, explicit owner station enrollment, connection fencing, durable message/operation receipts, heartbeat renewal, cancellation acknowledgement and browser backpressure.
- Add shared protocol schemas and dedicated runtime tests with independent 95% coverage floors; include all workspaces in root quality commands and CI artifacts.

### Changed

- Replace legacy machine REST mutations with typed, idempotent runtime operations while preserving human-only approval, reopening and real platform publication.
- Assign persistent source IDs, preserve per-stage drafts and undo, merge clean external changes, and reject stale draft proposals without overwriting local edits.
- Keep Local/Prod browser switching isolated from runtime identities; add a fixed production WebSocket proxy with exclusive upgrade routing and process-only Access credentials.
- Recover queued audio Workflow dispatches using the original job ID; distinguish a cancellation request from confirmed stopped work.

### Validation

- Local checks pass 264 web tests, 53 agent tests and 2 protocol tests, with every workspace above all four 95% coverage floors. Strict lint/types, build, deployment dry-run, frozen installation and index-snapshot gate checks pass.
- All nine agent browser journeys pass. The final 37-case browser run has 36 first-pass successes; the CDN-dependent theme image test passes its isolated rerun after an image timeout.
- Real local models complete writer -> independent reviewer -> coordinator acceptance -> versioned intent write. Browser draft rewriting leaves the canonical version unchanged; restart preserves root/reviewer identities and receipts.
- Production acceptance is performed after release deployment; local evidence does not claim production or paid-audio verification.

### Known Boundaries

- The full design's private R2 artifact catalogue, large-content chunk API and deterministic rich-Markdown-to-speech renderer are not part of this release. Paid audio and actual destination-platform publication are not exercised by release acceptance.

## 2.0.5 - 2026-10-03

### Changed

- Reorganize the repository as npm workspaces: `apps/web` owns the React app, Worker, migrations and tests; reserve `packages/agent` with only a tracked placeholder.
- Keep the release version and lockfile at the repository root. Update source imports, archived-font paths, local scripts, staged quality checks and coverage artifacts for the new application directory.
- Migrate development, builds, D1 operations and deployment to the pinned cf CLI and Cloudflare Vite beta; adopt base-ci v2026.8 without any direct or transitive Wrangler dependency.
- Preserve and byte-verify local D1/R2/workflow state in `apps/web/.cloudflare/state`, remove the legacy directory, and keep emulator caches inside `.cloudflare/cache`.
- Deploy the workspace through the release-only shared workflow, with exact local CLI version checks and production version/revision verification.
- Remove disposable local diagnostics and organize the standalone voice-comparison utility under `scripts/voice-comparison`.

### Validation

- 201 unit tests pass with all four coverage metrics above 95%; strict lint, type checking, production build, cf deployment dry-run and staged-gate failure probes pass at the new paths.

## 2.0.4 - 2026-10-01

### Changed

- Upgrade the Cloudflare Vite plugin to 1.62.3, Wrangler to 4.145.0 and Miniflare to 5.20260930.0-alpha; keep the deployment toolchain aligned and remove the obsolete worker discriminator from emulator fixtures.
- Upgrade Vite to 8.3.1, Vitest and its coverage provider to 5.0.3, Biome to 2.5.15 and Node types to 26.6.3.
- Update CodeMirror state/view, Lezer highlighting and the React editor wrapper, plus Lucide React 1.49.0, Marked 18.0.14 and Motion 13.4.6.

### Security

- Resolve all ten Undici advisories tracked in #11 through the upstream Cloudflare dependency on Undici 7.29.1, without a cross-major override.

### Validation

- 195 unit tests and 28 Chrome scenarios passed. Statement, branch, function and line coverage are 99.17%, 96.96%, 99.60% and 99.77%; strict lint, type checking, reproducible npm installation, production build and staged-gate failure probes passed.
- The owner accepted the local Caddy/Chrome build before publication. All 15 dependency issues (#1 through #15) are addressed by the resolving commits.

## 2.0.3 - 2026-09-26

### Added

- Eight public visual directions with the shared Open Interval identity and typography. The owner can preview and apply a theme in `/admin/appearance`; versioned saves detect concurrent edits, while public previews remain read-only.
- Archived identity studies, responsive R2 artwork, downloadable vector logos and an independent cover frame. Fonts ship with the application as fingerprinted same-origin assets.
- Finished-cover PNG downloads in the production studio, composing the clean original with the brand frame and actual episode number without uploading or changing the source.

### Changed

- Generated, uploaded and stored covers remain clean originals without text, logos, borders or overlays. Public pages and studio previews display the complete source image; only finished-cover downloads add branding.
- Unify long-form studio fields in the shared CodeMirror Markdown editor, preserving source text and undo history across previews. Compact navigation and URL-addressable source details keep the brief draft mounted and the studio within one main scroll region.
- D1 migration `0006_appearance.sql` initializes the persistent website appearance. Release deployment applies this schema migration before the Worker update and does not seed mock content.

### Fixed

- Render the canonical header and footer logos as inline SVG paths, removing the dependency on external SVG fragment loading.
- Replace incomplete R2 font URLs with bundled WOFF2 assets delivered atomically with the website, resolving the reported font 404s.

### Validation

- 195 unit tests passed; statement, branch, function and line coverage exceed 95%. Strict lint, type checking, production build and the normal staged commit gate passed.
- Seven focused Chrome scenarios passed, including all eight themes on desktop and phone, owner preview/apply, save failures and conflicts, public browsing and finished-cover PNG export without source mutations.
- All 42 identity artwork objects match archived SHA-256 digests and expected CDN content types, immutable cache policy and CORS headers. The production origin also passes its CORS check. All 102 bundled font sources match their emitted files or inline CSS data.

## 2.0.2 - 2026-09-26

### Fixed

- Replace the undersized 1536×1024 homepage and About artwork with a native 3504×2336 Sunburst reference-image edit, preserving the approved composition and archiving the original, prompt and generation metadata.
- Serve responsive WebP derivatives through immutable R2/CDN keys. Mobile crops retain the person's golden-ratio placement; source selection accounts for cover height and display pixel density.

### Validation

- Chrome and WebKit verified native source coverage, layout and image selection on 14/16-inch MacBook Retina, phone 3× and tablet displays for both pages. All four CDN derivatives match their archived SHA-256 digests.
- 183 unit tests and three public browser scenarios passed; all four coverage metrics exceed 95%. Strict lint, type checking, production build and the staged commit gate passed.

## 2.0.1 - 2026-09-26

### Added

- Owner-only R2 resource management at `/admin/storage`: paginated inventory, storage totals, image/audio/video filters, reference reasons, search, size/date sorting, previews and CDN-link copying in local and production environments.
- Confirmed, bounded cleanup of unused media, with fresh reference/version checks, per-file outcomes and actual reclaimed bytes. Brand assets, current episode/production/channel references, active audio jobs, bumper snapshots and uploads younger than 24 hours remain protected.
- Authenticated streaming previews with byte-range support for audio/video seeking. Partial scans disable cleanup; interrupted batches preserve known results and require rescanning. Scan and cleanup requests retain their original environment.

### Validation

- 183 unit tests, 21 Chrome scenarios and three focused WebKit scenarios passed. Statement, branch, function and line coverage exceed 95%; strict lint, type checking, production build and the normal staged commit gate passed.
- Integration tests exercise real Miniflare R2 pagination, newly attached references, replaced/missing objects, individual deletion failures, owner authorization, same-origin writes and media range responses. Existing production objects are not destructive test fixtures.

## 2.0.0 - 2026-09-25

### Added

- Private channel positioning at `/admin/channel`, initialized from the owner's editorial principles and editable with a Tiptap document editor, Chinese reading typography, formatting toolbar, outline, undo/redo and Markdown export.
- Environment-scoped browser drafts, keyboard saving and explicit version-conflict review. Failed saves, temporarily empty documents and oversized drafts remain recoverable.
- Authenticated, read-only `/api/agent/channel`, with discovery links, OpenAPI and Hermes instructions describing channel positioning as the highest editorial authority, followed by episode intent and source material.

### Changed

- All four production prompts include the latest saved channel profile and version. Copying an agent task refreshes its prompt; channel edits affect subsequent tasks without rewriting productions or revoking approvals.
- Internal positioning remains outside public discovery and client bundles. Agents cannot edit it or use editorial text to obtain approval/publication permissions.
- D1 migration `0005_channel.sql` adds the singleton versioned channel profile. This database-schema change advances the major version under the project release policy; release deployment applies the migration before the Worker update.

### Validation

- 173 unit tests, 18 Chrome scenarios and three focused WebKit scenarios passed. Statement, branch, function and line coverage exceed 95%; strict lint, type checking and production build passed.
- Real local saves, formatting, undo/redo, draft recovery, conflicts, mobile layouts and both themes were exercised. API tests cover owner writes, agent read-only access, private content and fresh prompts. Production acceptance is recorded with the release after deployment.

## 1.3.0 - 2026-09-25

### Added

- Public agent entrypoint, RFC 9727 API catalog, OpenAPI 3.1 contract, Hermes onboarding instructions and an `llms.txt` discovery index.
- Authenticated identity and capability endpoints for available voices, stage permissions, submission actions and blocking reasons.
- Environment-aware Hermes connection instructions and documentation links in studio settings.

### Fixed

- The advertised `/api/agent` URL no longer returns 404. Discovery paths reach the Worker instead of the SPA fallback.
- Use `HISFM_AGENT_TOKEN` consistently, accept case-insensitive Bearer schemes and return discovery links, structured errors and authentication challenges.

### Validation

- 172 unit tests and 15 browser scenarios passed; all four L1 coverage metrics exceed 95%. Strict lint, type checking and production build passed.
- Worker integration tests cover discovery, bearer authentication, CRUD, version conflicts, stage review boundaries, prompts, cover uploads, audio dispatch and token revocation. Production acceptance is recorded with the release after deployment.

## 1.2.1 - 2026-09-25

### Fixed

- Match admin browser chrome and safe-area backgrounds to the current Basalt theme; restore the public brand color when navigating out of the studio.
- Classify bounded Gemini errors into safe region, billing, key, voice, parameter and quota explanations instead of discarding every provider error detail.

### Validation

- 169 unit tests passed; all four L1 coverage metrics exceed 95%. Strict lint, type checking and production build passed.
- Chrome verified mobile navigation and theme persistence. Focused WebKit checks verified light/dark colors, reload, public/admin navigation and system-theme changes.
- Default Kore previews succeeded both locally and in production. The separately reported HTTP 400 is not claimed resolved without its failing inputs.

## 1.2.0 - 2026-09-25

### Added

- Thirty Gemini prebuilt voices with Chinese descriptions, editable speaking style and optional short cloud previews in studio settings and each audio generation.
- Owner-only preview API with validated WAV output, immutable R2 storage and content-addressed reuse through the media CDN.
- Per-generation voice/style snapshots independent of studio defaults, with optional intro/outro composition.

### Changed

- Generate approved-script narration without requiring intro/outro uploads; show the chosen voice and bumper inclusion on completed audio.
- Preserve queued job settings when redispatching and keep durable synthesis, assembly and attachment checkpoints.

### Fixed

- Bound long voice menus to the mobile viewport and hide stale previews after input changes.
- Separate application routing from the browser bootstrap to prevent duplicate React roots during Vite refresh.

### Validation

- 168 unit tests and 15 browser scenarios passed; statement, branch, function and line coverage all exceed 95%.
- Strict lint, type checking and production build passed. Live provider verification is recorded separately after deployment.

## 1.1.0 - 2026-09-25

### Added

- Five freely navigable production stages with green completion markers, bottom completion actions and explicit reopening for local agent revisions.
- Ready-to-copy local agent tasks with the selected environment, production ID, API instructions and saved source/intent context.
- Private xray-style Chinese long-form review typography, safe Markdown rendering and content-sized editing fields.

### Changed

- Owner brief and script completion save content and transition atomically, without a separate editorial submission step.
- Earlier edits revoke dependent confirmations while preserving existing scripts, media and publication history; agent permission boundaries remain unchanged.
- Show one production stage at a time, with separate cover/copy/audio tasks, clear execution locations and mobile layouts without nested text scrolling.

### Validation

- 162 unit tests and 14 browser scenarios passed; all four L1 coverage metrics exceed 95%.
- Chrome and WebKit verified private fonts, mobile reading, growing text fields and light/dark presentation.

## 1.0.0 - 2026-09-25

### Added

- AI podcast production studio: source material and editorial intent, versioned manuscripts, explicit human brief/script/final approvals, feedback history, parallel artwork/description/audio preparation and manual WeChat/Xiaoyuzhou publication records.
- Expiring, revocable Hermes bearer tokens with separate agent permissions; optimistic concurrency and protected public episode snapshots.
- Durable Gemini 3.8 Flash TTS workflow with immutable script/settings snapshots, streamed intro/narration/outro WAV assembly, R2 storage and atomic replay-safe completion.
- Six original Mandarin voice references in the Basalt studio, served through `f.no.mt`, with one-at-a-time playback and direct voice selection.
- Development-only Local / Production switch using a fixed-origin proxy and the editor's Cloudflare Access identity, without exposing credentials to the browser.
- Explicit, idempotent import of the existing first episode into local and production drafts; materials remain unapproved and unpublished.
- Deterministic his.fm cover framing and clean rich/plain publication copy formats.

### Changed

- Added production, agent-token, settings and audio-job database structures. The expanded schema and authentication surface move this release to 1.0.0 under the project versioning policy.
- Release deployment now uses Vite's generated Worker configuration, with exact version/revision verification after deployment.

### Fixed

- Unified the public page canvas, Safari toolbar color and safe-area insets; reframed mobile hero artwork around the subject at the golden section without text overlap.
- Moved the header's green brand dot into `his.fm` and replaced font-based decorative stars with consistent SVG artwork on desktop and iOS.

### Requirements

- The full audio workflow requires a configured Gemini Worker secret and real 24 kHz mono PCM16 intro/outro clips. The imported episode has written materials; a complete episode recording has not been generated.

## 0.1.0 - 2026-09-25

### Added

- Public Chinese podcast website and Cloudflare Access-protected Basalt studio.
- Local-only preview data, D1 episode CRUD, R2 media delivery at `f.no.mt`, and verified L1 quality gates.

- Release-driven CI/CD on nocoo/base-ci `v2026.7`: CI quality gate (typecheck, lint, unit tests with 95% coverage floors, secret and dependency scans, build, workflow lint) and a Release workflow that proves the release tag against passing main CI, applies D1 schema migrations, deploys the production Worker and verifies `/api/live` version and revision (`docs/ci-cd.md`).
