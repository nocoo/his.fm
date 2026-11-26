# CI/CD

Shared actions and deployment workflows come from [nocoo/base-ci](https://github.com/nocoo/base-ci), pinned by full commit SHA in `.github/workflows/quality-slots.yml` and `.github/workflows/release.yml` (currently `v2026.18`). Upgrade by updating the full SHA after a reviewed base-ci release.

## CI (`.github/workflows/ci.yml` & `.github/workflows/quality-slots.yml`)

Runs on every push to `main`, pull requests against `main`, and manual dispatch. `ci.yml` delegates to `.github/workflows/quality-slots.yml` (System1 Native Mode).

Enforced slots: **S1** typecheck, **S2** lint (Biome `--error-on-warnings`), **S3** workflow SHA-pin verification, **G1** secret scan (Gitleaks + `.gitleaks.toml`), **G2** dependency scan (OSV on `package-lock.json`), **B1** build (`ci:ensure-native-binaries && npm run build`, uploading `apps/web/.cloudflare/output/v0`), **L1** unit tests with 80% coverage floors (`apps/web` and `packages/contracts`; React views and generated platform declarations excluded), **L4** E2E (`apps/web/tests/e2e/ci-smoke.spec.ts` running Desktop Chromium against `vite preview` over the `B1` build artifact with isolated local D1 seed), **P1** package (`cf deploy --prebuilt --dry-run --mode production` against the `B1` build artifact), and **Z1** gate aggregate (`nocoo/base-ci/.github/actions/z1-gate`).

Runtime is pinned to Node `26.12.1` and npm `11.19.1` (`packageManager` in root `package.json`) with frozen `npm ci` (`install-policy: project`). CI sets npm retry env vars before install; `.npmrc` mirrors them for local installs. `ci:ensure-native-binaries` verifies lockfile optional native packages, rebuilds `workerd`, and smoke-tests the toolchain. Root `allowScripts` approves pinned `workerd` postinstalls.

**L2** (`Runtime`) and **L3** (`Integration`) are `N/A` (Miniflare/Worker bindings are covered in L1 Vitest; no standalone HTTP API E2E suite).

Coverage artifacts: `apps/web/coverage` and `packages/contracts/coverage`. Branch protection requires `quality / Z1: Gate` under workflow **CI**.

## Pre-commit staged gate

`sh .husky/pre-commit` (Husky `core.hooksPath=.husky/_`) runs the staged `scripts/check-staged.mjs` snapshot in order `test:coverage`, `lint`, `typecheck`, then validates staged `coverage-summary.json` floors (95% per statements, branches, functions, and lines) without changing the working tree or restaging fixes. `HISFM_GATE_TIMEOUT_MS` defaults to `180000`. Repeatable rejection probes live in `npm run test:gate` (`node scripts/verify-gate.mjs`), also run in CI after unit tests.

Measured baseline (cloud agent, npm install, Node 22.23.4, 2026-11-09): full-tree hook exit `0` with `@his-fm/web` coverage statements 97.74%, branches 95.05%, functions 98.62%, lines 98.6%; `@his-fm/contracts` statements 97.52%, branches 95.61%, functions 100%, lines 99.68%; cold wall time ~82800ms, warm ~79300ms (above the 30s design target). Self-test probes cover healthy fixture, UT failure, per-metric coverage shortfall (statements/branches/functions/lines), lint error, lint warning via Husky commit, type error, `.only`, skip-only, empty suite, staged-vs-worktree mismatch, timeout, interrupt, missing npm, missing coverage report/script, and staged `l1-snapshot.mjs` selection.

## Release (`.github/workflows/release.yml`)

Deployment triggers on:

| Trigger | Behavior |
| --- | --- |
| CI `workflow_run` (`success` on `push` to `main`) | auto-deploy proven `main` commit |
| GitHub Release published | deploy the release tag (verifies `vX.Y.Z` matches `package.json`) |
| Manual `workflow_dispatch` with tag input | redeploy an existing release tag (retry path) |

The deploy job uses base-ci `deploy-worker.yml`, which proves the release source before touching production:

1. resolves the tag to its exact commit and requires a successful CI run (`.github/workflows/ci.yml`, name `CI`, branch `main`) on that same SHA — `workflow_dispatch`-triggered CI runs also count as evidence;
2. requires the tag `vX.Y.Z` to equal `package.json` version at that commit (`package-version-match`);
3. installs from the proven repository root with the single workspace lockfile, runs `npm run ci:build` (`ci:ensure-native-binaries` then `npm run build` / `cf build`) so Linux platform optional packages match CI, then invokes `scripts/deploy.mjs` through `deploy-script`; the script verifies the exact local cf version from `apps/web/package.json` and runs the web workspace deploy command (versioned D1 migrations by production UUID, then `cf deploy --prebuilt --mode production`; seeding never runs in CI/CD);
4. verifies production through `node scripts/ci-verify-live.mjs`, which compares `/api/live` `status`, `service`, `version` and `revision` against `package.json` and the proven commit (`__BUILD_REVISION__` is injected at build time).

Production deploys hold a non-cancelling lock (`deploy-worker-production`) on the `production` GitHub environment.

The locked `cf` CLI (`1.0.0-beta.12`) and Cloudflare Vite plugin (`2.0.0-beta.sha-52b0dc0e9`) produce `apps/web/.cloudflare/output/v0`. Prebuilt deployment must use its recorded `production` mode. The shared workflow's script path avoids requiring a second lockfile inside `apps/web`. `scripts/deploy.mjs` retains exact CLI version verification before calling the web workspace; shared D1 migration steps are disabled because migrations must execute inside that workspace. The CLI comes from the hoisted root installation, resolved through package metadata rather than a hard-coded `node_modules` path. No Wrangler installation is needed, directly or transitively. Coverage artifacts come from `apps/web/coverage` and `packages/contracts/coverage`; root typecheck and test commands include every workspace, each with enforced 95% floors; root `package.json` remains the release-version authority.

### Versioning policy

Release procedure follows `system1-github-versioning` with one project override: every subsequent deployment increments **only the patch version** (`X.Y.Z` → `X.Y.(Z+1)`). Change the major or minor version only when the owner explicitly requests it. Features, database migrations, authentication changes, diff size and elapsed time must not trigger automatic major/minor bumps. Bump root `package.json`, update `CHANGELOG.md`, commit, push, wait for CI to pass on the commit, then tag `vX.Y.Z` and publish the GitHub Release with the changelog as What's New.

## Required repository secrets

Stored as repository Actions secrets and explicitly passed to the reusable deployment workflow. The deploy job targets the `production` environment; environment secrets with the same name would override repository values. Quality jobs receive no deployment secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token. Minimum scopes: Workers Scripts (Edit), D1 (Edit), Workers Routes (Edit, for the `his.fm` custom domain).
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

The website accepts no provider credentials and performs no generation. CI/CD has no model-provider secrets. Removing any historically configured remote secret or resource remains a separate authorized operational action.

## Local verification

Workflow files are validated in CI by the **S3** job inside `.github/workflows/quality-slots.yml`; no separate workflow-lint workflow is required. `scripts/ci-verify-live.mjs` is the release-time production check and expects the deployed Worker to be live.
