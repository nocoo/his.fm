# Architecture

his.fm has one React application and one Cloudflare Worker. Public pages use the Open Interval identity; the separately loaded studio uses Basalt 3.1.0. Frontend models/services own view state and HTTP calls. Shared validators define editable business fields; Worker controllers own D1, R2 and authorization.

Public section reveals use IntersectionObserver and CSS transitions, not an animation dependency. Each mounted section reveals once; reduced-motion preferences and keyboard focus expose content without waiting for viewport entry. React ref cleanup disconnects observers and removes event listeners on unmount.

`apps/web` contains the website, Worker, migrations and tests. `packages/contracts` contains scope, prompt and WAV validation. There is no embedded agent, WebSocket coordinator, generation worker or provider settings service. External clients generate assets elsewhere and use the scoped REST API.

## Request boundaries

| Route | Contract |
| --- | --- |
| `/api/live` | D1 health, release version and revision |
| `/api/episodes[/:slug]` | Published episodes whose publication date has arrived; catalogue JSON omits full transcripts |
| `/api/categories`, `/api/appearance` | Public metadata only |
| `/admin/api/session` | Verified owner identity |
| `/admin/api/*` | Owner management through shared controllers |
| `/api/agent`, `/.well-known/api-catalog`, `/llms.txt` | Public API discovery, no private content |
| `/api/agent/*` business routes | Explicitly scoped bearer management |
| `/media/*` | R2 streaming with HEAD, validators and single byte ranges |

Cloudflare Access JWTs are verified for signature, issuer, audience and expiry. An email header is never authentication. Human mutations require exact same-origin `Origin`. Bearer REST needs neither a browser session nor station enrollment. Public discovery does not establish authentication.

Local login requires `ENVIRONMENT=local` and an allowlisted hostname. Its eight-hour HttpOnly/SameSite session stores only a token hash in D1; production never accepts this login route. The existing Access application protects `his.fm/admin` and descendants unless a more specific application overrides it.

## Content and storage

A production is a versioned editorial record: sources, intent, script, descriptions, cover/audio assets, approvals and publication audit. The server does not fetch arbitrary source URLs. Field changes and approval transitions share the same state machine for owners and external clients; scopes do not bypass validity or versions.

Published episodes are snapshots, not live views of mutable productions. Public pages, feeds and catalogue JSON expose summaries and show notes only; full transcripts remain in admin and authenticated agent APIs. An explicit publication operation atomically updates the snapshot and appends an audit event. Editing a production preserves its public snapshot. Linked snapshot content cannot be changed through standalone episode CRUD; `featured` has a separate versioned display PATCH. Standalone episodes retain CRUD and can publish a manuscript without audio.

R2 assets use unique immutable keys. Detaching an asset does not delete bytes. Cleanup checks current references, saved media provenance, object versions and the 24-hour retention period; reserved brand/reference prefixes remain protected. Public and private media streaming share range handling so browser seeking works without downloading an entire recording first.

Migration 0015 retires operational tables, removes the production job field without changing assets/approvals/publications/versions, and retains allowlisted media provenance only. It preserves saved prompts, appends narration, and removes only retired text grants from valid token arrays. Unknown or malformed grants remain unusable; they never become authority.

## Interface and verification

- `/admin` is a unified cover-grid library with a list alternative. Production snapshots are deduplicated by explicit `sourceProductionId`, never by slug/title guesses.
- Production details have four non-linear sections: information, manuscript, assets and publication. Viewing a section does not mutate workflow state. Visited editors retain drafts and undo; approvals and saves are explicit.
- One custom `AudioPlayer` serves public and admin views. A hidden HTML audio element handles decoding; Basalt controls handle keyboard, pointer and touch seeking, volume, speed and errors.
- Prompt defaults are Worker-only; private prompt bodies never enter public discovery or the frontend bundle.
- Meaningful model/service/Worker/contracts tests enforce four 95% coverage floors. Miniflare covers actual D1/R2 behavior; browser checks exercise real controls with local or mocked content.
