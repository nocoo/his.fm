# Operations

## Develop

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run dev
```

If the preferred mirror does not contain a verified release, use the authorized Tencent mirror: `https://mirrors.tencent.com/npm/`. Do not use the blocked upstream registry on this machine.

Open `https://hisfm.dev.hexly.ai`. Choose the studio link or visit `/login`, then select the local studio button. The local database has six preview episodes; episode 001 imports the manuscript from `episodes/001-how-to-live-better/`.

The dev script listens on 127.0.0.1:7056 and defaults to local D1/R2 bindings. It reads Worker secrets from ignored `.dev.vars`, not the original generation `.env` file. Restarting preserves local records. Do not delete `.wrangler/state` to resolve unrelated issues.

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

`npm run cf:typegen` regenerates platform declarations without loading `.env`. Update the compatibility date only to a date supported by the installed Workerd runtime.

## Production preparation

Production configuration lives in `wrangler.jsonc`; local configuration is separate. The D1 database and R2 bucket are already created. Production D1 has the schema and no mock episode records. Four generated WebP images are stored in R2 under `images/`.

Access uses team `nocoo` and application audience `41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726`. Its protected path is `his.fm/admin`, including descendant routes through policy inheritance. The application verifies JWTs itself as well. `workers.dev` and preview URLs are disabled in production configuration.

Deployment follows published GitHub Releases; see [CI/CD](ci-cd.md). The build generates `dist/his_fm/wrangler.json`, which supplies the bundled Worker entrypoint and asset directory. Both migration and deployment use that generated configuration. Verify `https://his.fm/api/live` against the release version and Git SHA, then check public pages, an actual Access login and anonymous management rejection.

The owner-authorized real manuscript example can be imported explicitly after schema migration:

```sh
node scripts/import-example.mjs --local
node scripts/import-example.mjs --remote
```

The import preserves existing records and records no human approvals or publication. Local startup imports it once; production never loads the mock catalogue. The initial draft contains research, intent, manuscript and description, with no invented audio. Production Gemini credentials are stored as a Worker secret; configure real 24 kHz mono PCM16 WAV intro/outro clips in `/admin/settings` before requesting full narration.

## Use production data from the local interface

The unlabelled top-right Local / Production segment is development-only. Selecting Production verifies the editor's cached Access session and opens browser login through `cloudflared` when needed. Switching reloads the studio; only forms with unsaved changes require a discard confirmation. Local login and session bootstrap stay local, so the editor can always switch back after production authentication expires.

The Vite-only proxy forwards `/admin/remote-api/` to the fixed `https://his.fm/admin/api/` destination. Access tokens remain in cloudflared's local storage and the development server process; the browser never receives them. The production build contains no proxy endpoint. The production selection performs real production mutations. Restarting the local app does not reset that selection.

To upload later artwork, use an explicit R2 object key and correct content type. The owner configures the CDN; the Worker can serve objects under `/media/` in the meantime. Keep generated audio/video outside Git.
