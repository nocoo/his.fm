# Architecture

his.fm has one React application and one Cloudflare Worker. Public views in `apps/web/src/public/` use the Open Interval identity; separately loaded studio views in `apps/web/src/admin/` use `@nocoo/basalt` with standalone CSS and granular shell imports. Keep editable episode validation in `apps/web/src/shared/episode.ts`, production contracts in `apps/web/src/shared/production.ts`, view logic in models/services, and D1/Access/R2 logic in `apps/web/worker/`.

Public routes are `/`, `/episodes`, `/episodes/:categoryId/:slug` and `/about` (legacy `/episodes/:slug` redirects to the category path). `/login` is the studio entry and no public surface links it. Studio settings are Appearance, Connections, Prompts, Categories, Bumpers and Storage; narration is ordinary prompt-slot text, not a provider setting.

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
| `/api/agent`, `/.well-known/api-catalog`, `/llms.txt`, `/api/card` | Public API discovery and read-only card protocol v1 ([card-api](card-api.md)), no private content |
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
- Studio navigation sections use native `SidebarGroup` disclosures so Basalt owns their spacing and the single navigation gutter; collapsed rails render the same destinations as centered `SidebarIconItem` rows without custom group wrappers.
- Studio breadcrumbs derive from the current pathname and query in `admin/navigation.model.ts`, ending with one nonlinked current item. Ancestors are real router links and detail selections live in the address bar (production sections/sources, prompt scopes/slots, appearance theme preview) so refresh and browser back/forward restore selections; narrow headers scroll only the breadcrumb strip, never the shell.
- Keep `.admin-content-island` positioned for absolute descendants; section navigation resets only its scroll without scrolling the overflow-hidden shell or hiding its header. Keep headers compact with actions alongside titles; secondary back controls belong left of the title.
- Production details have four non-linear sections: information, manuscript, assets and publication. Viewing a section does not mutate workflow state. Visited editors retain drafts and undo; approvals and saves are explicit.
- One custom `AudioPlayer` serves public and admin views. A hidden HTML audio element handles decoding; Basalt controls handle keyboard, pointer and touch seeking, volume, speed and errors.
- The active player supplies native Media Session metadata. Public episodes use the published 1400-square `/episodes/{id}/art.jpg` composition, not the favicon or responsive artwork crop. Metadata survives pauses, updates with active details, and clears on source replacement, unmount or media failure without clearing another player's session. Unillustrated admin previews replace previous artwork. Native media transport remains browser-owned; iOS lock-screen layout and effects are not website CSS.
- Prompt defaults are Worker-only; private prompt bodies never enter public discovery or the frontend bundle.
- Meaningful model/service/Worker/contracts tests enforce four 95% coverage floors. Miniflare covers actual D1/R2 behavior; browser checks exercise real controls with local or mocked content.
