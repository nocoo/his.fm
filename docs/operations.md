# Operations

## Develop

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run dev
```

If the preferred mirror does not contain a verified release, use the authorized Tencent mirror: `https://mirrors.tencent.com/npm/`. Do not use the blocked upstream registry on this machine.

Open `https://hisfm.dev.hexly.ai`. Choose the studio link or visit `/login`, then select the local studio button. The local database has six preview episodes; episode 001 imports the manuscript from `episodes/001-how-to-live-better/`.

The dev script listens on 127.0.0.1:7056 and defaults to local D1/R2 bindings. It reads Worker secrets from ignored `apps/web/.dev.vars`, not the original generation `.env` file. Restarting preserves local records. Local D1 and R2 data live in `apps/web/.cloudflare/state`; do not delete it to resolve unrelated issues. CLI commands run from `apps/web` with `--local --persist-to .cloudflare/state`. The local-only UUID is `00000000-0000-4000-8000-000000007056`. Existing state was copied and byte-verified before the legacy directory was removed. Never substitute the production UUID when accessing local data.

Website styles are selected in `/admin/appearance`. Previewing is read-only; applying saves to the selected environment. See [appearance](appearance.md) for identity assets, R2 delivery, font caching and original-cover/export separation.

## Validate

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
node scripts/verify-gate.mjs
```

`npm run prepare` installs the Husky launcher. The pre-commit hook reads the staged gate implementation and checks an isolated snapshot of the index. It runs coverage, lint and typecheck without auto-fixing or restaging files. Generated outputs stay in temporary directories.

`npm run cf:typegen` regenerates ignored `apps/web/.cloudflare/types/index.d.ts` without loading `.env`; typecheck runs this first, including in isolated staged snapshots. Update the compatibility date only to a date supported by the installed Workerd runtime.

## Production preparation

Configuration lives in `apps/web/cloudflare.config.ts`. Only Vite development mode enables local login and local resources; omitted and production modes retain production settings. The D1 database and R2 bucket are already created. Production D1 has the schema and no mock episode records. R2 contains fingerprinted brand artwork and separately uploaded editorial media.

Access uses team `nocoo` and application audience `41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726`. Its protected path is `his.fm/admin`, including descendant routes through policy inheritance. The application verifies JWTs itself as well. `workers.dev` and preview URLs are disabled in production configuration.

Deployment follows published GitHub Releases; see [CI/CD](ci-cd.md). The build generates `apps/web/.cloudflare/output/v0`, containing the bundled Worker, assets and production configuration. The release workflow installs and builds from the repository root, then runs `scripts/deploy.mjs`. The script checks the web workspace's exact cf version and delegates versioned D1 migrations and deployment to `apps/web`, running `cf deploy --prebuilt --mode production`. Validate without uploading from `apps/web` with `cf deploy --prebuilt --mode production --dry-run`. Wrangler is not installed, directly or transitively. Verify `https://his.fm/api/live` against the release version and Git SHA, then check public pages, an actual Access login and anonymous management rejection.

The owner-authorized real manuscript example can be imported explicitly after schema migration:

```sh
cd apps/web
node scripts/import-example.mjs --local
node scripts/import-example.mjs --remote
```

The import preserves existing records and records no human approvals or publication. Local startup imports it once; production never loads the mock catalogue. The initial draft contains research, intent, manuscript and description, with no invented audio. Content generation happens outside the website. Upload completed recordings and clean covers through the versioned assets API or studio. Optional 24 kHz mono PCM16 WAV bumpers remain at `/admin/bumpers` for external composition; the website does not generate or mix audio.

## Public delivery and SEO

Production custom domains are `his.fm` and `www.his.fm`. The Worker redirects
HTTP and www to `https://his.fm`, preserving the path and query. After release,
verify DNS, TLS and the actual 308 response for each origin; an HTTP connection
timeout is not redirect evidence. Keep the existing Access boundary on the
canonical admin hostname; alternate hosts redirect before authentication.

Only the named `PublicContent` entrypoint enables native Workers Cache. The
default gateway remains uncached and supplies a fresh CSP nonce for each HTML
delivery. Successful public HTML templates live for 60 seconds and versioned,
theme-specific WebP thumbnails for one hour. Private/API/authentication responses
never enter this cache. Successful content/SEO/appearance mutations purge this
entrypoint synchronously. `X-Public-Cache: invalidation-failed` and the structured
`public_cache_purge_failed` log mean the content write succeeded but the cache
purge did not; read the current version before any further edit, rather than
blindly replaying a successful write. Do not enable cross-version cache sharing.

Verify real edge `X-Public-Cache`/`CF-Cache-Status` and repeated-request timings.
`UNKNOWN` means no native cache status was supplied, not a proven miss or hit.
The pinned local Miniflare does not emulate native Workers Cache or its purge;
unit invocation tests and local browser checks do not prove edge propagation.
Do not withdraw or edit production content solely to manufacture purge evidence.

The `IMAGES` binding streams published R2 originals into fixed, centered WebP
derivatives. Check a real `/media/episode-thumbnails/:id/:version/:theme/:width.webp`
response after deployment: status 200, `image/webp`, decoded dimensions and bytes.
Native sources above 20 MB or transformation failures redirect to the validated
original with `no-store` and `X-Thumbnail-Status: original`; inspect the
`episode_thumbnail_failed` log before claiming optimization succeeded. R2 originals,
RSS/OG images and composed PNG exports are not rewritten. Check current Images
availability/quotas; release authorization does not enable a paid subscription.

Test built public pages with JavaScript disabled and with a
`securitypolicyviolation` listener in Chrome. The development CSS pipeline is not
production no-JavaScript evidence, and absence of `pageerror` alone does not prove
CSP compliance. Retain the static public CSS imports before the deferred React
bootstrap. Follow [the content checklist](seo-content-checklist.md) for owner
identity, the 3000-square podcast cover, separate 1200x630 OG artwork and the
reviewed production correction; deployment does not supply or save those values.

## Use production data from the local interface

The unlabelled top-right Local / Production segment is development-only. Selecting Production verifies the editor's cached Access session and opens browser login through `cloudflared` when needed. Switching reloads the studio; only forms with unsaved changes require a discard confirmation. Local login and session bootstrap stay local, so the editor can always switch back after production authentication expires.

The Vite-only proxy forwards `/admin/remote-api/` to the fixed `https://his.fm/admin/api/` destination. Access tokens remain in cloudflared's local storage and the development server process; the browser never receives them. The production build contains no proxy endpoint. The production selection performs real production mutations. Restarting the local app does not reset that selection.

To upload later artwork, use an explicit R2 object key and correct content type. The owner configures the CDN; the Worker can serve objects under `/media/` in the meantime. Keep generated audio/video outside Git.

## R2 resource management

Open `/admin/storage` to scan the selected local or production `his-fm` bucket. The Basalt browser shows size totals, image/audio/video filters, reference reasons, search, size/date sorting and paged previews. Opening the page never deletes files. Scan totals are partial until every R2 cursor has been consumed; failed scans disable cleanup.

Owner APIs inherit Cloudflare Access authentication. External clients use the same resource controllers at `/api/agent/storage` with explicit `storage:read`, `storage:write` and `storage:delete` grants.

- `GET /admin/api/storage?cursor=...`: up to 200 objects, including immutable R2 versions, MIME types, size, upload time, reference state/reasons and a nullable next cursor. Follow the cursor even when a page contains fewer than 200 objects.
- `GET|HEAD /admin/api/storage/object?key=...`: authenticated streaming preview with single byte-range support for seeking. Active document formats download as attachments. Local-to-production media previews use the owner's CDN `https://f.no.mt` directly.
- `POST /admin/api/storage/cleanup`: same-origin JSON `{ "items": [{ "key": "old/file.wav", "version": "version-from-scan" }] }`, at most 50 items. The UI confirms the environment, selected count and bytes, then submits batches of 25. Responses report each key as `deleted`, `skipped` or `failed`, with actual deleted bytes. A transport failure leaves the known results visible and requires a new scan.

Cleanup re-reads D1 references and R2 object metadata before deletion. It protects all production assets and owned media URLs in production text/sources, draft/published episode fields and mentions, site/episode/category SEO, global prompt and current bumper settings. Failed or unsuccessful reference-query batches block deletion. Retained historical media provenance protects existing audio and bumper references after operational job tables are retired. `images/` and `reference/` are reserved for brand artwork and voice references. All uploads remain protected for 24 hours to cover pending attachment to D1 attachment updates. Other media become candidates only when unreferenced and beyond that retention window.

“Unused” means no detected in-app reference, not proof of no external use. Review externally shared links before confirming deletion. R2 has no conditional-delete primitive or transaction with D1: version checks catch changes since scanning but cannot serialize arbitrary concurrent external bucket writes or new references. Avoid simultaneous reference edits or external overwrites during cleanup. Uploads use unique immutable media keys. Deleting from R2 reclaims origin storage but does not purge already cached CDN copies. This module does not compress or replace existing media.


## Retirement migration

Migration 0015 removes operational task/runtime/generation tables after retaining allowlisted media provenance. Production versions, assets, approvals and publication audit remain intact; the obsolete job field is removed. Saved prompt bodies remain unchanged and missing narration is appended with a channel version increment. Token arrays lose only retired text grants, without widening surviving authority or normalizing malformed grant sets.

Back up the selected environment before applying a data-retirement migration. Test preservation with `tests/worker/retirement.test.ts` against actual Miniflare first. For local state, stop the dev server before copying `apps/web/.cloudflare/state`, keep the backup ignored, and restart only the existing local dev service. Never apply mock seeds remotely. Do not delete ignored local archives, private external-client configuration, remote secrets or orphaned Cloudflare resources as part of source cleanup; those are separate authorized operations.

The release script applies migrations before deploying the Worker. For this retirement release, a failed deploy can leave the old Worker querying removed tables; rolling back only the Worker cannot restore those tables. Before an authorized release, verify the prebuilt artifact/deploy dry run and the retired Durable Object export transition, take a restorable D1 backup, and agree on a maintenance/cutover window and either forward deployment recovery or paired database/Worker restoration. This local refactor does not verify that remote cutover or authorize deleting remote runtime resources.

For v2.4.0, the owner authorized permanent deletion of the production `AgentHub` namespace on 2026-10-16. The production-only `deleted` export tombstone performs this through the release deployment; development configuration leaves local state untouched. Record a fresh D1 Time Travel bookmark and pre-migration preservation evidence under ignored `.local/releases/` before publishing. Time Travel continuously backs up D1 and its bookmark restores the database within the provider's retention window; it cannot recover deleted Durable Object data. Keep editorial writes and external runtime clients stopped during cutover. Recovery is a forward deployment of the CMS, not a Worker-only rollback across the irreversible Durable Object lifecycle change. Do not delete other namespaces, secrets, source archives or R2 media. After successful reconciliation, the tombstone can be removed in a subsequent release.

## External clients

Issue tokens at `/admin/connections` with the minimum required explicit scopes and expiry. Read [API onboarding](api-onboarding.md) for the supported business workflow. Full scope grants permit real CRUD/review/publication-record operations, not paid generation or infrastructure access. Token revocation cascades; deleting an already revoked list record does not erase its authorization tombstone.

Ordinary narration guidance lives in the current environment's versioned D1 prompt slots (legacy bundle until explicit migration), not shared provider configuration. Local/Production switches affect website data only; they never move content or credentials between environments.

## Prompt slot migration

Deployment of migration 0023 only adds columns and a backup table. It never applies editorial migration. Follow the separately authorized per-level dry-run/apply procedure in [prompt slots](prompts.md). Inspect live `legacyVersion` and all unmapped headings, including learning/manager-notes; do not assume production still matches v11. Backups retain original text, versions and actor/timestamps in `prompt_slot_backups`; slot edits and category deletion do not delete them. R2 cleanup reads both legacy and current slot bodies so new media references remain protected. This implementation/testing does not authorize production apply.
