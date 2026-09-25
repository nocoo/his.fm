# Architecture

his.fm has one React application and one Cloudflare Worker. Public pages use an original editorial design; the separately loaded administration bundle uses Basalt 2.1.8. Both share the episode schema, while frontend models/services and Worker modules own business behavior.

## Request boundaries

| Route | Behavior |
| --- | --- |
| `/api/live` | D1 connectivity and service health |
| `/api/episodes` | Published episodes whose publication date has arrived |
| `/api/episodes/:slug` | One visible episode; missing/draft/future episodes return 404 |
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

Images are optimized WebP assets. Originals, prompts, model details and SHA-256 digests remain in `artwork/`. The initial four images are also stored under `images/` in R2. The public shell uses bundled artwork for immediate rendering; editors can use `/media/images/...` for R2 media or an HTTPS CDN URL when the owner configures one.

## Interface and verification

- Public: responsive navigation, animated hero, episode catalogue, topic/search filters, detail pages, summaries, transcripts, native audio controls when media exists, about page and missing/error/empty states.
- Admin: Basalt visitor badge, AppShell, compact episode table, draft/published filters, complete editor, field validation, destructive-action confirmation, responsive navigation and theme switching.
- Animation respects reduced-motion preferences. Navigation, fields and controls have keyboard focus states.
- Unit coverage targets shared validation, frontend models/services and Worker behavior. Worker tests use actual Miniflare D1/R2 plus signed JWT fixtures. Browser checks exercise rendered interactions. L1 evidence is stored in nmem rather than asserted by a repository badge.

AI production orchestration, audio generation, video editing and asset upload UI are outside this initial CRUD iteration. No inert controls imply those tools already work.
