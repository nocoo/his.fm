# Scoped site API

## Authorized outcome

Replace identity-based machine restrictions with explicitly granted API scopes.
An owner may issue a token with the complete current scope catalogue to manage
all site business operations without taking over the resident Frogie station.
Keep business validation, optimistic versions, immutable asset provenance and
honest audit identities. Credentials are write-only. Database internals, external
platform publishing, infrastructure administration and deployment are not part
of this work.

Human sessions retain owner authority. Bearer tokens default to no authority;
unknown scopes and legacy unscoped credentials fail closed. Reissue credentials
and explicitly re-enroll stations after the change; never silently upgrade tokens.

## Permission contract

Scopes are finite `resource:action` strings. Presets expand to explicit grants;
there is no wildcard granting future capabilities.

| Resource | Actions |
| --- | --- |
| productions | read, write, delete, submit, approve, reopen |
| publications | read, write, delete |
| episodes | read, write, delete, publish |
| categories | read, write, delete |
| prompts | read, write |
| appearance | read, write |
| settings | read, write |
| credentials | write |
| audio | generate |
| bumpers | read, write, delete |
| storage | read, write, delete |
| tokens | read, issue, revoke |
| tasks | read, submit, cancel, manage |
| runtime | connect, manage |

All entrypoints reuse domain controllers. REST business writes do not require a
station. Runtime connection leases still fence execution, not general API access.
Approval grants allow genuine API approvals without pretending the actor is human.
Token delegation cannot exceed the issuer's scopes or expiry. Read projections
must not leak private prompts through production/category or mutation responses.

Task submissions persist their originator and authorization ceiling. Effects are
bounded by both execution credentials and the originator's current grants; revoked
or expired originators cannot continue through a more privileged coordinator.

The native coordinator and reusable executors share history across tasks. This
iteration does not provide per-token conversation isolation. Agent-origin tasks
require `tasks:submit`, `tasks:manage` and `prompts:read`; production context also
requires `productions:read`. Audio/preview requests require `audio:generate` with
the same shared-history/read prerequisites. `tasks:manage` explicitly authorizes
shared coordinator history. The executor itself need not hold that grant. Ordinary
REST business operations remain independently scoped without entering native history.

## Business boundaries

- Edit business fields through versioned operations, never fabricated IDs,
  versions, approvals, task completion flags or transport receipts.
- Preserve publication snapshots and provide explicit correction/withdrawal
  operations rather than silently desynchronizing a production and its episode.
- Preserve referenced storage, immutable media keys, job snapshots and active work.
- Native AI settings are shared across Local/Prod; disclose that scope explicitly.
  Do not return existing secrets or expose arbitrary local configuration files.
- Public discovery remains public; private OpenAPI schemas contain no prompt bodies.

## Implementation sequence

- [x] Add shared scopes, principals and authorization helpers with focused tests.
- [x] Implement explicit token grants, bounded delegation and the owner scope UI.
- [x] Authorize shared controllers and expose scoped REST management operations.
- [x] Complete missing business CRUD and publication lifecycle operations.
- [x] Add scoped task submission/inspection/cancellation and delegation fencing.
- [x] Synchronize capability discovery, OpenAPI, onboarding and project rules.
- [x] Run unit coverage, strict lint/types, build and focused browser verification.
- [x] Review privilege boundaries and commit verified logical changes.

## Verification

Use isolated fixture databases, fake providers and local test servers. No live
tokens, real private configuration, production mutations or paid generation.
Test scope denial, projected reads, cross-token delegation, revocation during
queued work, optimistic conflicts and a fully authorized business workflow.
Keep all existing four-metric 95% coverage floors and the normal staged gate.
