# CI/CD

Shared workflows come from [nocoo/base-ci](https://github.com/nocoo/base-ci), pinned to the immutable commit `8816553dc9f4544d1e8486bacb5cce630a9f14cb` (`v2026.8`). Upgrade by updating the full SHA after a reviewed base-ci release.

## CI (`.github/workflows/ci.yml`)

Runs on every push to `main`, pull requests against `main`, and manual dispatch. Two reusable gates:

- `quality.yml` — typecheck (`npm run typecheck`, `cf workers types` followed by strict `tsc --noEmit`), lint (`npm run lint`, Biome recommended preset, warnings rejected), unit tests with the four 95% coverage floors (`npm run test:coverage`), Gitleaks secret scan plus OSV dependency scan on `package-lock.json`, and a build (`npm run build`, Vite plus the Cloudflare Workers build). The aggregate emits `tested-sha` only when every enabled job succeeded on the same commit.
- `workflow-lint.yml` — actionlint syntax validation of both workflow files and enforcement of full-SHA base-ci references.

Runtime is pinned to Node `26.9.0` and npm `11.19.1` with frozen `npm ci`. `install-policy: project` keeps the project lifecycle (Husky `prepare`) because the Vite/Workers toolchain requires native postinstall binaries (esbuild, workerd).

## Release (`.github/workflows/release.yml`)

Deployment is release-driven; nothing deploys automatically from a bare push to `main`:

| Trigger | Behavior |
| --- | --- |
| GitHub Release published | deploy the release tag |
| Manual `workflow_dispatch` with tag input | redeploy an existing release tag (retry path) |

The deploy job uses base-ci `deploy-worker.yml`, which proves the release source before touching production:

1. resolves the tag to its exact commit and requires a successful CI run (`.github/workflows/ci.yml`, name `CI`, branch `main`) on that same SHA — `workflow_dispatch`-triggered CI runs also count as evidence;
2. requires the tag `vX.Y.Z` to equal `package.json` version at that commit (`package-version-match`);
3. rebuilds from the proven source, selects `deploy-cli: cf`, verifies the project-local `cf-version`, applies schema-only migrations with `cf d1 migrations apply 66f7e201-22a8-450d-838d-ecbc382afbc6` (the default `migrations/` directory), then deploys with `cf deploy --prebuilt --mode production` (seeding never runs in CI/CD);
4. verifies production through `node scripts/ci-verify-live.mjs`, which compares `/api/live` `status`, `service`, `version` and `revision` against `package.json` and the proven commit (`__BUILD_REVISION__` is injected at build time).

Production deploys hold a non-cancelling lock (`deploy-worker-production`) on the `production` GitHub environment.

The locked `cf` CLI (`1.0.0-beta.12`) and Cloudflare Vite plugin (`2.0.0-beta.sha-52b0dc0e9`) produce `.cloudflare/output/v0`. Prebuilt deployment must use its recorded `production` mode. The shared workflow uses its native `cf` path for CLI verification, D1 migrations and prebuilt deployment. No `deploy-script` override or Wrangler installation is needed. `d1-databases` contains the production UUID; cf remote migrations do not accept the Wrangler `--remote` flag. The dependency lockfile has no direct or transitive Wrangler package, enforced by a tooling regression test.

Release procedure follows `system0-github-versioning`: bump `package.json`, maintain `CHANGELOG.md`, commit, push, tag `vX.Y.Z`, publish the GitHub Release with the changelog as What's New. Publishing the Release triggers this workflow; CI must have passed on the tagged commit first.

## Required repository secrets

Stored as repository Actions secrets and explicitly passed to the reusable deployment workflow. The deploy job targets the `production` environment; environment secrets with the same name would override repository values. Quality jobs receive no deployment secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token. Minimum scopes: Workers Scripts (Edit), D1 (Edit), Workers Routes (Edit, for the `his.fm` custom domain); Workflows (Edit) is also required for the `his-fm-audio` Workflows binding.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

`GEMINI_API_KEY` is a Worker runtime secret managed by the owner through `cf`; CI/CD never touches it.

## Local verification

Workflow files are validated in CI by `workflow-lint.yml` (actionlint plus immutable-pin checks); no local helper is required. `scripts/ci-verify-live.mjs` is the release-time production check and expects the deployed Worker to be live.
