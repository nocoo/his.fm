# Documentation

## Product

- [Architecture](architecture.md): public/private boundaries, content records and storage.
- [Production](production.md): cover-first library, editing, approval and publication.
- [Audio](audio.md): external recording uploads and custom playback.
- [Prompts](prompts.md): private editorial, workflow and narration instructions.
- [Categories](categories.md): metadata, private guidance and versioned changes.
- [Markdown editing](markdown-editing.md): draft retention, safe preview and clipboard formats.
- [Appearance](appearance.md): public themes, immutable originals and branded exports.
- [Design research](design/README.md): visual research and provenance.

## API and operations

- [API onboarding](api-onboarding.md): external-client starting point, served at `/api/agent/instructions`.
- [API reference](agent-api.md): route families and business contracts.
- [Scope model](scoped-api.md): explicit grants, delegation and response projections.
- [Operations](operations.md): local setup, safe storage management and release boundaries.
- [CI/CD](ci-cd.md): quality gates and exact-revision release deployment.

The website manages podcast content. Content generation happens externally; it has no embedded agent, task transport or provider execution service. Historical release and retrospective records describe their original revisions, not the current contract.
