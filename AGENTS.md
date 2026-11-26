# his.fm

Podcast CMS served by one React 19 / Vite 8 / TypeScript 7.0.2 Cloudflare Worker (`apps/web`) with shared validators (`packages/contracts`).
Docs: [README](README.md) · [Architecture](docs/architecture.md) · [Appearance](docs/appearance.md) · [Markdown](docs/markdown-editing.md) · [Categories](docs/categories.md) · [Operations](docs/operations.md) · [CI/CD](docs/ci-cd.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Node `>=26` and npm `11.19.1` (`packageManager`). Env variable names live in `.env.example`; Worker secrets live in ignored `apps/web/.dev.vars`.

```sh
npm ci
npm run dev                # migrates & seeds local D1 once -> 127.0.0.1:7056
npm run typecheck          # S1 (runs cf:typegen first)
npm run lint               # S2 Biome check-only, 0 warnings
npm run test:coverage      # L1 Vitest >= 80% across all workspaces
npm run test:gate          # L1 Husky staged-gate self-test probes
npm run test:e2e           # L4 Playwright (local dev stack, or CI smoke with CI=true)
npm run build              # B1 critical CSS + cf build -> apps/web/.cloudflare/output/v0
npm run cf:typegen         # regenerate Worker types without loading .env
npm run check:cover-frames # verify exported theme cover frame assets
```

## Invariants

- **CMS scope**: `apps/web` owns UI/Worker/migrations/tests, `packages/contracts` shared validators, root `package.json` the version; never add embedded agents, task queues, provider settings or generation routes.
- **Cloudflare toolchain**: Use the pinned `cf` CLI and `apps/web/cloudflare.config.ts` (never Wrangler); run Worker-first with no asset SPA fallback and redirect HTTP/`www.his.fm` to HTTPS apex.
- **Auth & scopes**: Verify Access JWTs in the Worker (never trust email headers); human writes require same-origin `Origin`; bearer routes use finite grants without wildcards ([scoped-api.md](docs/scoped-api.md)).
- **Versions & projections**: Read != write, approve != reopen; existing writes use optimistic versions, and linked snapshots allow only `featured` PATCH ([production.md](docs/production.md)).
- **Structured episodes**: Use structured columns + `episode_topics`/`episode_mentions` (no free-form body) ([episode-structure.md](docs/episode-structure.md)); dedupe `/admin` only by `sourceProductionId`.
- **UI surfaces**: Public views (`src/public/`) keep Open Interval (`his.fm ()`, footer, sticky rail); studio (`src/admin/`) uses `@nocoo/basalt` standalone CSS and shell ([appearance.md](docs/appearance.md)).
- **Covers & icons**: Stored covers must be clean originals without text, logos or frames; previews, `IMAGES` WebP thumbs and 1600px PNG export never mutate originals; app icons are theme-independent.
- **Audio uploads**: Accept 24 kHz mono PCM16 WAV or MP3 (<=7,200s; 96 kbps mono MP3 recommended for new episodes; WAV masters archive in Google Drive `his.fm/`) only on an approved script (`productions:write` + `storage:write`); `audio/bind` deletes adopted `uploads/` staging copies after D1 commit; detach keeps R2 bytes for the GC grace window; bumpers stay WAV-only ([audio.md](docs/audio.md)).
- **Prompt slots**: Manage channel/category prompts via versioned slot tables (reject legacy `prompt`; `skills` names only); deploy applies D1 migrations before Worker ([prompts.md](docs/prompts.md)).
- **SSR, CSP & SEO**: Load static public CSS before jitless deferred React; inject fresh CSP nonces after `PublicContent` cache; omit drafts/transcripts/audit and never link `/login` publicly ([seo.md](docs/seo.md)).
- **API & editorial**: Sync `/api/agent`, `/llms.txt`, `/api/card` and [api-onboarding.md](docs/api-onboarding.md); public copy is Chinese, code/docs English ([editorial-policy.md](docs/editorial-policy.md)).
- **Storage & seeds**: R2 (`his-fm`) holds active production CDN assets only — never archive masters or raw WAVs in R2 (archives live in Google Drive `his.fm/`). Never seed mocks remotely or fabricate audio; `rendered/` uses content-addressed keys (`rendered/art/` and `rendered/share/`) shared across productions and episodes; cleanup and daily Worker Cron GC (`storage_gc_queue`) scan all cursors, recheck D1/versions, protect manifest-backed brand WebPs & voice-preview MP3s plus <24h uploads, and auto-purge unreferenced `uploads/` after 24h and other unreferenced objects after a 7-day grace window ([operations.md](docs/operations.md)).
- **Authz & versioning**: Dev/tests never authorize paid generation, private creds, prod writes or publishing; deploys bump only patch (`X.Y.Z` -> `X.Y.(Z+1)`) unless owner asks ([ci-cd.md](docs/ci-cd.md)).
- **Repo hygiene**: Keep `.env`, `apps/web/.dev.vars`, generated media, local Cloudflare state, screenshots and coverage out of Git; `artwork/` originals and prompts remain intentionally archived.

## Quality & Local Gates

Follows `system1-quality`; CI slot definitions and pinned `base-ci` revision live in `.github/workflows/quality-slots.yml` (`quality / Z1: Gate` required on `main`). Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` and `L3 Integration` are `N/A` (Worker bindings in `L1`; no standalone API E2E). `L4 E2E` (`ci-smoke.spec.ts` against `B1` preview build) and `P1 Package` (`cf deploy --prebuilt --dry-run`) are `enforced`.
- **Coverage scope**: `L1` enforces 80% (statements/branches/functions/lines) across workspaces, excluding React views and generated types; web Vitest caps at 4 workers ([operations.md](docs/operations.md)).
- **Local hooks**: `npm run prepare` installs `.husky/pre-commit`, running staged `scripts/check-staged.mjs` (`test:coverage`, `lint`, `typecheck` + 80% floors) without editing the worktree; `pre-push` is `N/A`.

## Resources & Isolation

| Lane | Endpoint / State | Boundary |
| --- | --- | --- |
| Dev | `https://hisfm.dev.hexly.ai` -> `127.0.0.1:7056`, D1 `00000000-0000-4000-8000-000000007056` | Local `.cloudflare/state`; `ENVIRONMENT=local` only in `development` mode; preserve local edits |
| Tests | Ports `17056` (integration), `27056` (browser), `37056` (inspector) | Isolated Miniflare/R2 fixtures (`r2-fixtures.ts`) and synthetic media only |
| Prod | `https://his.fm` (Worker/D1 `66f7e201-22a8-450d-838d-ecbc382afbc6`/R2 `his-fm`), CDN `https://f.no.mt` | Access protects `his.fm/admin`; `dev:remote` is read-only; deploy via `release.yml` + `/api/live` |

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests or hooks.
