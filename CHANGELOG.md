# Changelog

All notable changes to his.fm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use the owner’s patch-only deployment policy in `AGENTS.md`, with the authoritative version in `package.json`.

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
