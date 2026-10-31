# Podcast production

The website manages podcast records and assets; it does not generate content. Owners and authorized external clients collect sources, prepare text and media outside the site, then save through the same versioned controllers. Source URLs are references, not server-side fetch instructions.

## Library and editor

`/admin` combines productions and standalone episodes in a cover-first grid, with list, search, status and category controls. Linked public snapshots appear only once, using `sourceProductionId`. Standalone records keep `/admin/episodes/:id`; new production creation also links to direct finished-episode entry.

Production details expose four URL-addressable sections: `?section=metadata|manuscript|assets|publication`. Sections are freely navigable and do not themselves change saved state. Visited Markdown editors remain mounted to preserve drafts/undo. Source detail navigation uses persistent source IDs; explicit brief saving persists sources together. The content island scrolls without moving the shell header.

## Review state

The stored state machine remains:

`draft -> brief_review -> scripting -> script_review -> production -> final_review -> ready`

- `productions:write` edits permitted business fields, not versions or approval records.
- `productions:submit` submits brief/script/final material for review.
- `productions:approve` confirms the exact version after validation.
- `productions:reopen` permits reopening and revision actions. Approval does not imply reopening.
- Owner sessions have full business authority, but all validation and optimistic conflicts still apply.

Existing-record writes carry the current version; stale writes return 409. Actions may include validated changes for an atomic save and transition. Earlier edits invalidate dependent approvals and make script-dependent media stale without deleting files, text or publication history. Full-scope clients can complete the workflow, but cannot forge IDs, audits, versions or completed asset validation.

## Assets

The assets section organizes a clean cover, full recording, short summary and publication description. Upload and detach operations are explicit and versioned. Recording uploads require an approved current script. Final review requires nonempty summary/description, a current-script cover and a current-script recording with valid duration.

Cover originals must have no text, logos, borders or overlays. Only the finished-cover download composes the independent Open Interval frame into a 1600x1600 PNG; it never replaces the stored original. See [appearance](appearance.md).

Recording uploads accept 24 kHz mono PCM16 WAV or MP3 (`audio/mpeg`), up to one hour. There is no in-site TTS, mixing, paid generation, task queue or voice comparison. Bumpers remain an independent downloadable/uploadable library for external composition. See [audio](audio.md).

## Publication

WeChat copy provides the exact sanitized HTML preview plus plain text. External links become numbered references; unsafe HTML and unapproved embedded images are removed. Xiaoyuzhou copy preserves clean paragraphs. Copying material never marks it published and the site never logs into either platform.

An authorized publisher records a real platform URL and past publication time. The transaction checks final approval and the current version, appends an audit event and updates the linked website episode snapshot. Corrections use PATCH on the platform record; withdrawals use DELETE. Withdrawing the last platform makes the snapshot draft without deleting its content or immutable media. Revisions never leak into the snapshot during withdrawal. Independent `featured` metadata survives later publication updates.

Read [API onboarding](api-onboarding.md) and [scopes](scoped-api.md) before connecting an external client. Prompts guide content; they cannot grant permissions or override facts.

Channel and category [prompt slots](prompts.md) carry independent collection versions. Private production prompt reads compose enabled slots by stable ID with category `append`/`override`, before episode intent/materials. Prompt slot edits do not change production versions, review state or publication snapshots.
