# Architecture

his.fm has one React application and one Cloudflare Worker. Public pages use the Open Interval identity; the separately loaded studio uses Basalt 3.2.0. Frontend models/services own view state and HTTP calls. Shared validators define editable business fields; Worker controllers own D1, R2 and authorization.

Public section reveals use IntersectionObserver and CSS transitions, not an animation dependency. Each mounted section reveals once; reduced-motion preferences and keyboard focus expose content without waiting for viewport entry. React ref cleanup disconnects observers and removes event listeners on unmount.

`apps/web` contains the website, Worker, migrations and tests. `packages/contracts` contains scope, prompt and WAV validation. There is no embedded agent, WebSocket coordinator, generation worker or provider settings service. External clients generate assets elsewhere and use the scoped REST API.

## Request boundaries

| Route | Contract |
| --- | --- |
| `/api/live` | D1 health, release version and revision |
| `/api/episodes[/:slug]` | Published episodes whose publication date has arrived; catalogue JSON omits full transcripts |
| `/api/categories`, `/api/appearance` | Public metadata only |
| `/api/site-seo` | Public site/author/podcast metadata, without settings audit fields |
| `/admin/api/session` | Verified owner identity |
| `/admin/api/*` | Owner management through shared controllers |
| `/api/agent`, `/.well-known/api-catalog`, `/llms.txt` | Public API discovery, no private content |
| `/api/agent/*` business routes | Explicitly scoped bearer management |
| `/media/*` | R2 streaming with HEAD, validators and single byte ranges |
| `/media/episode-thumbnails/:id/:version/:theme/:width.webp` | Fixed artwork-only WebP derivatives of current published R2 covers |

The default gateway is uncached. Canonical public page and thumbnail requests
enter the named `PublicContent` entrypoint's native Workers Cache without user
credentials. HTML templates live for 60 seconds; each delivery receives a fresh
CSP nonce and downstream `no-store`. Relevant successful mutations purge the
owning entrypoint. Static public CSS remains available before the deferred,
jitless-configured browser bootstrap. See [SEO](seo.md) for cache and image
boundaries, and [operations](operations.md) for edge verification.

Cloudflare Access JWTs are verified for signature, issuer, audience and expiry. An email header is never authentication. Human mutations require exact same-origin `Origin`. Bearer REST needs neither a browser session nor station enrollment. Public discovery does not establish authentication.

Local login requires `ENVIRONMENT=local` and an allowlisted hostname. Its eight-hour HttpOnly/SameSite session stores only a token hash in D1; production never accepts this login route. The existing Access application protects `his.fm/admin` and descendants unless a more specific application overrides it.

## Content and storage

A production is a versioned editorial record: sources, intent, script, descriptions, cover/audio assets, approvals and publication audit. The server does not fetch arbitrary source URLs. Field changes and approval transitions share the same state machine for owners and external clients; scopes do not bypass validity or versions.

Published episodes are snapshots, not live views of mutable productions. Public pages, feeds and catalogue JSON expose summaries and show notes only; full transcripts remain in admin and authenticated agent APIs. An explicit publication operation atomically updates the snapshot and appends an audit event. Editing a production preserves its public snapshot. Linked snapshot content cannot be changed through standalone episode CRUD; `featured` has a separate versioned display PATCH. Standalone episodes retain CRUD and can publish a manuscript without audio.

Optional production SEO follows the same approval/publication boundary. A change
reopens final approval without invalidating the approved script. Omitted SEO
preserves the snapshot's overrides; an explicit empty object clears them only
on reviewed publication/correction.

R2 assets use unique immutable keys. Detaching an asset does not delete bytes. Cleanup checks current references, saved media provenance, object versions and the 24-hour retention period; reserved brand/reference prefixes remain protected. Public and private media streaming share range handling so browser seeking works without downloading an entire recording first.

Migration 0015 retires operational tables, removes the production job field without changing assets/approvals/publications/versions, and retains allowlisted media provenance only. It preserves saved prompts, appends narration, and removes only retired text grants from valid token arrays. Unknown or malformed grants remain unusable; they never become authority.

Channel and category prompt-slot JSON arrays use independent collection counters; slot versions and audit live in each array. Migration `0027_drop_legacy_prompts.sql` removed legacy whole-prompt columns. Slot CRUD uses the collection CAS and does not mutate productions; merged reads apply category append/override by stable ID. See [prompt slots](prompts.md).

## Interface and verification

- `/admin` is a unified cover-grid library with a list alternative. Production snapshots are deduplicated by explicit `sourceProductionId`, never by slug/title guesses.
- Studio navigation uses browser paths, with a complete breadcrumb trail derived from the same pathname and query. Ancestors are real router links; the current item is not a link. Production sections/sources and prompt scopes/slots appear in the trail. Appearance theme selection uses a query parameter, without saving settings; cover previews automatically use recent library entries. Refresh and browser back/forward restore URL-driven selections; narrow headers scroll the breadcrumb strip instead of the application shell.
- Production details have four non-linear sections: information, manuscript, assets and publication. Viewing a section does not mutate workflow state. Visited editors retain drafts and undo; approvals and saves are explicit.
- One custom `AudioPlayer` serves public and admin views. A hidden HTML audio element handles decoding; Basalt controls handle keyboard, pointer and touch seeking, volume, speed and errors.
- The active player supplies native Media Session metadata. Public episodes use the published 1400-square `/episodes/{id}/art.jpg` composition, not the favicon or responsive artwork crop. Metadata survives pauses, updates with active details, and clears on source replacement, unmount or media failure without clearing another player's session. Unillustrated admin previews replace previous artwork. Native media transport remains browser-owned; iOS lock-screen layout and effects are not website CSS.
- Prompt defaults are Worker-only; private prompt bodies never enter public discovery or the frontend bundle.
- Meaningful model/service/Worker/contracts tests enforce four 95% coverage floors. Miniflare covers actual D1/R2 behavior; browser checks exercise real controls with local or mocked content.
