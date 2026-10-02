# Architecture

his.fm has one React application and one Cloudflare Worker. Public pages use an original editorial design; the separately loaded administration bundle uses Basalt 2.2.0. Both share the episode schema, while frontend models/services and Worker modules own business behavior.

## Request boundaries

| Route | Behavior |
| --- | --- |
| `/api/live` | D1 connectivity and service health |
| `/api/episodes` | Published episodes whose publication date has arrived |
| `/api/episodes/:slug` | One visible episode; missing/draft/future episodes return 404 |
| `/api/appearance` | Public theme ID only, never owner metadata |
| `/admin/api/appearance` | Owner-selected website theme with optimistic version updates |
| `/admin/api/session` | Verified editor identity and local/Access mode |
| `/admin/api/episodes` | Authenticated list and create |
| `/admin/api/episodes/:id` | Authenticated read, update and delete |
| `/admin/api/dev-login` | Development-only session creation |
| `/admin/api/logout` | Revoke local session or navigate to Access logout |
| `/media/*` | R2 image/media reads with metadata and conditional ETag handling |

All management traffic reaches the Worker before SPA asset handling. Production verifies the Access JWT signature, issuer, audience and expiry against the team's published signing keys. Missing credentials cannot reach management APIs. Mutation requests require an exact same-origin `Origin` header. Input is bounded, parsed with Zod and written with prepared statements. Slug conflicts return 409. IDs and timestamps are server-owned.

The existing Access application at `his.fm/admin` covers descendant paths through [Access path inheritance](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), unless a more specific application overrides that policy.

Local authentication is intentionally a different mode: the Worker must have `ENVIRONMENT=local` and receive an allowed local hostname. The login response sets an eight-hour HttpOnly, SameSite session cookie; only a SHA-256 token hash is stored in D1. Production rejects local-login requests, even if a local cookie is supplied.

## Content and storage

Episode records contain publication metadata, summary, transcript, show notes, topic, tags, artwork and optional audio URL. A published manuscript may have no audio yet; the listening page says so and provides the text. Future-dated episodes stay out of public queries.

Migrations create tables only. The dev script applies migrations with `--local` and runs an idempotent local seed. A seed marker preserves subsequent edits and deletions. No mock records are imported to production.

Images are optimized WebP assets. Originals, prompts, model details and SHA-256 digests remain in `artwork/`. Public images and media use the R2 custom domain `https://f.no.mt`; local uploaded assets use `/media/` against local R2. Six original voice references live under `reference/voices/` in R2.

## Interface and verification

- Public: eight responsive visual directions sharing the Open Interval identity, episode catalogue, topic/search filters, detail pages, summaries, transcripts, native audio controls when media exists, about page and missing/error/empty states. See [appearance](appearance.md).
- Admin: Basalt visitor badge, AppShell, compact episode table, draft/published filters, complete editor, field validation, destructive-action confirmation, responsive navigation and theme switching.
- Animation respects reduced-motion preferences. Navigation, fields and controls have keyboard focus states.
- Unit coverage targets shared validation, frontend models/services and Worker behavior. Worker tests use actual Miniflare D1/R2 plus signed JWT fixtures. Browser checks exercise rendered interactions. L1 evidence is stored in nmem rather than asserted by a repository badge.

The production studio uses a versioned D1 record, explicit human reviews and immutable R2 assets. Hermes calls bearer-authenticated `/api/agent/` routes; Cloudflare Access remains mandatory for human production administration. Local agents write scripts, descriptions and framed covers. Cloudflare Workflows synthesizes the approved script through Gemini, assembles the configured intro and outro, and attaches the result atomically. See [production](production.md) and [agent API](agent-api.md). Video production is not implemented.
