# Operations

## Develop

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run dev
```

If the preferred mirror does not contain a verified release, use the authorized Tencent mirror: `https://mirrors.tencent.com/npm/`. Do not use the blocked upstream registry on this machine.

Open `https://hisfm.dev.hexly.ai`. Choose the studio link or visit `/login`, then select the local studio button. The local database has six preview episodes; episode 001 imports the manuscript from `episodes/001-how-to-live-better/`.

The dev script listens on 127.0.0.1:7056 and defaults to local D1/R2 bindings. It reads Worker secrets from ignored `apps/web/.dev.vars`, not the original generation `.env` file. Restarting preserves local records. Local D1, R2 and workflow data live in `apps/web/.cloudflare/state`; do not delete it to resolve unrelated issues. CLI commands run from `apps/web` with `--local --persist-to .cloudflare/state`. The local-only UUID is `00000000-0000-4000-8000-000000007056`. Existing state was copied and byte-verified before the legacy directory was removed. Never substitute the production UUID when accessing local data.

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

Configuration lives in `apps/web/cloudflare.config.ts`. Only Vite development mode enables local login and local resources; omitted and production modes retain production settings. The D1 database and R2 bucket are already created. Production D1 has the schema and no mock episode records. Four generated WebP images are stored in R2 under `images/`.

Access uses team `nocoo` and application audience `41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726`. Its protected path is `his.fm/admin`, including descendant routes through policy inheritance. The application verifies JWTs itself as well. `workers.dev` and preview URLs are disabled in production configuration.

Deployment follows published GitHub Releases; see [CI/CD](ci-cd.md). The build generates `apps/web/.cloudflare/output/v0`, containing the bundled Worker, assets and production configuration. The release workflow installs and builds from the repository root, then runs `scripts/deploy.mjs`. The script checks the web workspace's exact cf version and delegates schema-only D1 migrations and deployment to `apps/web`, running `cf deploy --prebuilt --mode production`. Validate without uploading from `apps/web` with `cf deploy --prebuilt --mode production --dry-run`. Wrangler is not installed, directly or transitively. Verify `https://his.fm/api/live` against the release version and Git SHA, then check public pages, an actual Access login and anonymous management rejection.

The owner-authorized real manuscript example can be imported explicitly after schema migration:

```sh
cd apps/web
node scripts/import-example.mjs --local
node scripts/import-example.mjs --remote
```

The import preserves existing records and records no human approvals or publication. Local startup imports it once; production never loads the mock catalogue. The initial draft contains research, intent, manuscript and description, with no invented audio. Production Gemini credentials are stored as a Worker secret; configure real 24 kHz mono PCM16 WAV intro/outro clips in `/admin/settings` before requesting full narration.

## Use production data from the local interface

The unlabelled top-right Local / Production segment is development-only. Selecting Production verifies the editor's cached Access session and opens browser login through `cloudflared` when needed. Switching reloads the studio; only forms with unsaved changes require a discard confirmation. Local login and session bootstrap stay local, so the editor can always switch back after production authentication expires.

The Vite-only proxy forwards `/admin/remote-api/` to the fixed `https://his.fm/admin/api/` destination. Access tokens remain in cloudflared's local storage and the development server process; the browser never receives them. The production build contains no proxy endpoint. The production selection performs real production mutations. Restarting the local app does not reset that selection.

To upload later artwork, use an explicit R2 object key and correct content type. The owner configures the CDN; the Worker can serve objects under `/media/` in the meantime. Keep generated audio/video outside Git.

## R2 resource management

Open `/admin/storage` to scan the selected local or production `his-fm` bucket. The Basalt browser shows size totals, image/audio/video filters, reference reasons, search, size/date sorting and paged previews. Opening the page never deletes files. Scan totals are partial until every R2 cursor has been consumed; failed scans disable cleanup.

Owner APIs inherit Cloudflare Access authentication. Agents have no resource-cleanup capability.

- `GET /admin/api/storage?cursor=...`: up to 200 objects, including immutable R2 versions, MIME types, size, upload time, reference state/reasons and a nullable next cursor. Follow the cursor even when a page contains fewer than 200 objects.
- `GET|HEAD /admin/api/storage/object?key=...`: authenticated streaming preview with single byte-range support for seeking. Active document formats download as attachments. Local-to-production media previews use the owner's CDN `https://f.no.mt` directly.
- `POST /admin/api/storage/cleanup`: same-origin JSON `{ "items": [{ "key": "old/file.wav", "version": "version-from-scan" }] }`, at most 50 items. The UI confirms the environment, selected count and bytes, then submits batches of 25. Responses report each key as `deleted`, `skipped` or `failed`, with actual deleted bytes. A transport failure leaves the known results visible and requires a new scan.

Cleanup re-reads D1 references and R2 object metadata before deletion. It protects all production assets and owned media URLs in production text/sources, draft/published episode fields, global prompt and current bumper settings. Queued/running audio jobs protect their entire output prefix and captured bumper keys. `images/` and `reference/` are reserved for brand artwork and voice references. All uploads remain protected for 24 hours to cover pending attachment to D1 and workflow state updates. Replaced covers/bumpers, preview caches and completed/failed job intermediates become candidates only when unreferenced and beyond that retention window.

“Unused” means no detected in-app reference, not proof of no external use. Review externally shared links before confirming deletion. R2 has no conditional-delete primitive or transaction with D1: version checks catch changes since scanning but cannot serialize arbitrary concurrent external bucket writes or new references. Avoid simultaneous reference edits or external overwrites during cleanup. The app generates unique media keys; preview-cache keys are content-addressed. Deleting from R2 reclaims origin storage but does not purge already cached CDN copies. This module does not compress or replace existing media.


## Local native agent

The native coordinator runs separately from Vite: `npm run agent -- start --environment local`. Its sole private configuration is `~/.config/his.fm/config.json`; do not put provider/Jev/site keys in `.dev.vars`, browser state or the repository. Explicit owner enrollment binds the chosen token to its station. See [implementation status](agent-implementation.md) and [onboarding](native-agent.md).

The top-right Local/Prod control selects the website data environment only. It does not retarget a live daemon. A production coordinator needs its own token, station binding and deployed matching protocol. Test Local with synthetic data; do not seed production or invoke paid audio during routine verification.
