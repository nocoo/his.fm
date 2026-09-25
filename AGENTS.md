# his.fm

## Architecture

- React 19 + Vite 8 + TypeScript 7.0.2, served by one Cloudflare Worker.
- Public views live in `src/public/`. Admin views live in `src/admin/` and use `@nocoo/basalt` 2.1.8 with standalone CSS and granular shell imports.
- Keep editable episode validation in `src/shared/episode.ts`, business logic in `model.ts` / `service.ts`, and D1 / Access / R2 logic in `worker/`.
- Public routes: `/`, `/episodes`, `/episodes/:slug`, `/about`. Admin routes and APIs share `/admin`; `/login` is the public entry badge.
- Production Access issuer and audience are checked cryptographically in the Worker. Never trust an email header as authentication.
- Preserve the internal editorial policy in README. Public content and episode materials are Chinese; code and technical documentation are English.

## Local development

- `npm run dev` migrates and seeds local Wrangler D1 once, then starts Vite on loopback port 7056.
- User-facing URL: `https://hisfm.dev.hexly.ai`. Caddy proxies to `127.0.0.1:7056` and permits only loopback clients.
- Reserved ports: integration 17056, browser 27056, inspector 37056. See nmem `hisfm-local-ports` before changing them.
- `wrangler.local.jsonc` has only local bindings and `ENVIRONMENT=local`. Local login requires this flag, an allowed hostname and same-origin requests. It creates an expiring HttpOnly session; production never enables it.
- Mock content exists only in `scripts/seed-local.mjs`; schema migrations contain no episode content. Do not seed remote D1. Preserve existing local edits and deletions across restarts.
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

Install through an allowed registry on this machine. Never retry blocked `registry.npmjs.org`. `npm install` runs `prepare`; `npm run prepare` reinstalls Husky if needed.

## Quality and Git

- L1 checks meaningful Worker, schema, model and service behavior with Vitest. All four coverage floors are 95%; React views and generated platform declarations are excluded from unit coverage.
- Biome uses its maintained recommended preset and rejects warnings. TypeScript is strict.
- Husky runs checks against the Git index snapshot, without changing the working tree or restaging fixes. Stage explicit paths, then commit through the normal hook.
- Audit evidence belongs in nmem, using `6dq-audit-github.com-nocoo-his.fm-l1`; no full 6DQ certification is implied by L1.
- Keep `.env`, `.dev.vars`, generated audio/video, Wrangler state, test screenshots and coverage out of Git. Image-generation originals and prompts are intentionally archived in `artwork/`.
- Record corrected mistakes in `Retrospective.md`. Preserve other agents' edits; only the coordinator stages and commits.

## Cloudflare

- Production domain: `his.fm`; Worker, D1 and R2 names: `his-fm`.
- D1 ID: `66f7e201-22a8-450d-838d-ecbc382afbc6`.
- The existing Access application protects `his.fm/admin`; descendant paths inherit its policy unless a more specific application overrides them.
- `run_worker_first` covers `/admin`, `/admin/*`, `/api/*` and `/media/*`.
- `npm run deploy` builds the production configuration before deploying. Local acceptance precedes release/deployment; never deploy a development configuration.
- R2 image keys are `images/hero.webp` and `images/episode-01.webp` through `episode-03.webp`. `/media/*` serves configured R2 objects; the owner manages the CDN domain.

See `docs/architecture.md` and `docs/operations.md` for contracts and operating steps.
