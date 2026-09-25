# Changelog

All notable changes to his.fm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the authoritative version in `package.json`.

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

### Requirements

- The full audio workflow requires a configured Gemini Worker secret and real 24 kHz mono PCM16 intro/outro clips. The imported episode has written materials; a complete episode recording has not been generated.

## 0.1.0 - 2026-09-25

### Added

- Public Chinese podcast website and Cloudflare Access-protected Basalt studio.
- Local-only preview data, D1 episode CRUD, R2 media delivery at `f.no.mt`, and verified L1 quality gates.

- Release-driven CI/CD on nocoo/base-ci `v2026.7`: CI quality gate (typecheck, lint, unit tests with 95% coverage floors, secret and dependency scans, build, workflow lint) and a Release workflow that proves the release tag against passing main CI, applies D1 schema migrations, deploys the production Worker and verifies `/api/live` version and revision (`docs/ci-cd.md`).
