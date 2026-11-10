# CI/CD

Shared workflows come from [nocoo/base-ci](https://github.com/nocoo/base-ci), pinned to the immutable commit `1ea10ecab22b72512399485391603fe03a161016` (`v2026.12`). Upgrade by updating the full SHA after a reviewed base-ci release.

## CI (`.github/workflows/ci.yml`)

Runs on every push to `main`, pull requests against `main`, and manual dispatch. A single job calls base-ci `quality.yml` with **strict** `slot-status` (CI slot standard v1 in base-ci `docs/slots.md`).

Enabled slots: **S1** typecheck, **S2** lint (Biome), **S3** workflow lint (actionlint + immutable base-ci SHA pins + required `deploy-worker.yml` reference), **G1** secret scan (Gitleaks + `.gitleaks.toml`), **G2** dependency scan (OSV on `package-lock.json`), **B1** build (`npm run build` after native-binary prep), **L1** unit tests with 95% coverage floors plus `npm run test:gate` (Husky L1 snapshot self-test), and **Z1** gate aggregate.

Runtime is pinned to Node `26.12.1` and npm `11.19.1` (`packageManager` in root `package.json`) with frozen `npm ci` (`install-policy: project`). CI applies `env-json` npm retry settings before install; `.npmrc` mirrors them for local installs. `prepare-command` runs `ci:ensure-native-binaries` (lockfile optional native packages, `workerd` rebuild, toolchain smoke). Root `allowScripts` approves pinned `workerd` postinstalls.

**L1.5**, **L2**, and **P1** are declared `na` in `slot-status` (Worker binding coverage lives in L1 Vitest; no API E2E command; private packages). **L3** Playwright suites exist locally but are `todo` until CI can start the loopback dev stack and set `HISFM_E2E_BASE_URL`.

Coverage artifacts: `apps/web/coverage` and `packages/contracts/coverage`. Branch protection should require only the Z1 check name reported on a real CI run (typically `quality / Z1: Gate` under workflow **CI**).

## Release (`.github/workflows/release.yml`)

Deployment is release-driven; nothing deploys automatically from a bare push to `main`:

| Trigger | Behavior |
| --- | --- |
| GitHub Release published | deploy the release tag |
| Manual `workflow_dispatch` with tag input | redeploy an existing release tag (retry path) |

The deploy job uses base-ci `deploy-worker.yml`, which proves the release source before touching production:

1. resolves the tag to its exact commit and requires a successful CI run (`.github/workflows/ci.yml`, name `CI`, branch `main`) on that same SHA — `workflow_dispatch`-triggered CI runs also count as evidence;
2. requires the tag `vX.Y.Z` to equal `package.json` version at that commit (`package-version-match`);
3. installs from the proven repository root with the single workspace lockfile, runs `npm run ci:build` (`ci:ensure-native-binaries` then `npm run build` / `cf build`) so Linux platform optional packages match CI, then invokes `scripts/deploy.mjs` through `deploy-script`; the script verifies the exact local cf version from `apps/web/package.json` and runs the web workspace deploy command (versioned D1 migrations by production UUID, then `cf deploy --prebuilt --mode production`; seeding never runs in CI/CD);
4. verifies production through `node scripts/ci-verify-live.mjs`, which compares `/api/live` `status`, `service`, `version` and `revision` against `package.json` and the proven commit (`__BUILD_REVISION__` is injected at build time).

Production deploys hold a non-cancelling lock (`deploy-worker-production`) on the `production` GitHub environment.

The locked `cf` CLI (`1.0.0-beta.12`) and Cloudflare Vite plugin (`2.0.0-beta.sha-52b0dc0e9`) produce `apps/web/.cloudflare/output/v0`. Prebuilt deployment must use its recorded `production` mode. The shared workflow's script path avoids requiring a second lockfile inside `apps/web`. `scripts/deploy.mjs` retains exact CLI version verification before calling the web workspace; shared D1 migration steps are disabled because migrations must execute inside that workspace. The CLI comes from the hoisted root installation, resolved through package metadata rather than a hard-coded `node_modules` path. No Wrangler installation is needed, directly or transitively. Coverage artifacts come from `apps/web/coverage` and `packages/contracts/coverage`; root typecheck and test commands include every workspace, each with enforced 95% floors; root `package.json` remains the release-version authority.

Release procedure follows `system0-github-versioning`: bump `package.json`, maintain `CHANGELOG.md`, commit, push, tag `vX.Y.Z`, publish the GitHub Release with the changelog as What's New. Publishing the Release triggers this workflow; CI must have passed on the tagged commit first.

## Required repository secrets

Stored as repository Actions secrets and explicitly passed to the reusable deployment workflow. The deploy job targets the `production` environment; environment secrets with the same name would override repository values. Quality jobs receive no deployment secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token. Minimum scopes: Workers Scripts (Edit), D1 (Edit), Workers Routes (Edit, for the `his.fm` custom domain).
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

The website accepts no provider credentials and performs no generation. CI/CD has no model-provider secrets. Removing any historically configured remote secret or resource remains a separate authorized operational action.

## Local verification

Workflow files are validated in CI by the **S3** job inside `quality.yml`; no separate workflow-lint workflow is required. `scripts/ci-verify-live.mjs` is the release-time production check and expects the deployed Worker to be live.
