# Operations

## Develop

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run dev
```

If the preferred mirror does not contain a verified release, use the authorized Tencent mirror: `https://mirrors.tencent.com/npm/`. Do not use the blocked upstream registry on this machine.

Open `https://hisfm.dev.hexly.ai`. Choose the studio link or visit `/login`, then select the local studio button. The local database has six preview episodes; episode 001 imports the manuscript from `episodes/001-how-to-live-better/`.

The dev script listens on 127.0.0.1:7056, loads only local D1/R2 bindings and does not use the Gemini `.env` file. Restarting preserves local records. Do not delete `.wrangler/state` to resolve unrelated issues.

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

After local user acceptance and release preparation:

```sh
npx wrangler d1 migrations apply his-fm --remote --config wrangler.jsonc
npm run deploy
```

Verify `https://his.fm/api/live`, public pages and an actual Access login. Confirm unauthenticated management requests are rejected, local login remains unavailable and production has no mock content. The production website has not been deployed as part of initial local acceptance.

To upload later artwork, use an explicit R2 object key and correct content type. The owner configures the CDN; the Worker can serve objects under `/media/` in the meantime. Keep generated audio/video outside Git.
