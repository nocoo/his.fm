# Changelog

All notable changes to his.fm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the authoritative version in `package.json`.

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
