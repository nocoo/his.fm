# Scoped site API

## Authority

Owners issue finite explicit `resource:action` grants. There is no wildcard that silently gains future permissions. The owner preset expands to the complete current catalogue; reader/editor are convenience selections, not security roles. Tokens without grants or with unknown/malformed grants fail closed.

| Resource | Actions |
| --- | --- |
| productions | read, write, delete, submit, approve, reopen |
| publications | read, write, delete |
| episodes | read, write, delete, publish |
| categories | read, write, delete |
| prompts | read, write |
| appearance | read, write |
| bumpers | read, write, delete |
| storage | read, write, delete |
| tokens | read, issue, revoke, delete |

These 30 grants cover all surviving website business modules. A full-scope token can manage content, prompts, assets, reviews, publication records, appearance and other tokens. It cannot execute models, access provider credentials, write database internals, administer Cloudflare, deploy the site or post to external publishing platforms. There is no native runtime, station, task API or generation scope.

## Tokens

Issuance requires explicit nonempty, unique scopes and an expiry of 1-365 days. A delegated issuer needs `tokens:issue`; the child scopes and expiry cannot exceed the issuer, checked again during insertion. Human sessions retain owner authority. Raw random tokens appear once; D1 stores SHA-256 hashes only.

Revocation cascades through descendants. Deletion hides an already revoked record but preserves the tombstone and ancestry; it never revives authority. Active and merely expired tokens must be revoked first. A machine cannot revoke/delete a target outside its grants. Invalid legacy metadata is visible for owner cleanup without making that token usable.

## Projection and validation

Read is not implied by write. Production/episode/bumper writes without the corresponding read grant return only `{id, version}` inside their resource envelope. Prompt writes without read return the version only. Publication records and audit events are omitted without `publications:read`; category prompts are omitted without `prompts:read`.

All actors use the same domain validation and optimistic versions. `productions:approve` does not grant `productions:reopen`. Publication snapshots remain protected from standalone CRUD, storage cleanup preserves references and retention, and media keys are immutable. A caller cannot write arbitrary IDs, versions, audit actors, approval fields or internal database state.

Migration 0015 removes only retired text grants from token arrays, leaving remaining business grants unchanged. It never broadens tokens or normalizes invalid JSON shapes into grants. Reissue tokens with no surviving authority. Public schemas/discovery reveal no private prompt bodies or authentication secrets.

## Verification

Use fixture D1/R2, synthetic files and mocked/local browser requests. Tests cover denial, projection, bounded delegation, revocation, version conflicts, invalid grants, migration preservation and a fully authorized upload/review/publication workflow. Keep all four 95% coverage floors and the normal staged gate. Production validation is a separately authorized operation.
