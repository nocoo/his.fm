# Private prompt catalogue

The studio's **Prompts** page stays at `/admin/channel`. A URL-addressable selector
(`?prompt=<key>`) displays one editor; visited editors retain drafts and undo.
Defaults are Chinese. The former separate narration settings route is removed;
its controls now live at `?prompt=narration`. Category metadata remains in
`/admin/categories`; its prompt editor lives at `?prompt=category:<id>`.

## Inventory and consumers

| Key | Previous source | Consumer |
| --- | --- | --- |
| `content` | `worker/channel-default.md` | Global editorial guidance, unchanged owner content |
| `coordinator` | Native `ROOT_POLICY` | Root system instructions for each durable input |
| `executor` | Native `WORK_POLICY` | General executor system instructions |
| `reviewer` | Shared executor policy | Additional independent review instructions |
| `speech` | Shared executor policy and speech guidance | Dedicated speech conversation, without CodingTools |
| `capabilities` | `EXECUTOR_CAPABILITIES` prose | Root and immutable assignment capability envelope |
| `network` | `networkContext` prose | Credential-free network envelope |
| `decisionPlan`, `decisionThinking` | Jev question instructions | Current assignment's two decision questions |
| `compaction` | Pi Durable's built-in English summary prompt | Summary-only model boundary |
| `editorial`, `boundary` | `production-prompts.ts` | Stage prompts and executor policy |
| `brief`, `script`, `cover`, `description` | `production-prompts.ts` | Private production prompt API and native assignment bundle |
| `voiceComparison` | English voice comparison style | Subsequent comparison previews; prior styles remain immutable provenance |
| Category prompt | Existing category record | Selected category guidance and revision fence |
| Narration style | Existing native speech settings | Provider style and immutable preview/audio snapshot |

Stage prompts are provided to the coordinator and executors in `channel.prompts`;
the Chinese role defaults instruct them to apply the matching stage to their
assigned deliverable, not to perform every stage. The production prompt API
combines the saved stage, priority and boundary instructions with exact current
production/category data. There is no duplicate browser default or native policy
fallback. All named defaults reside in the **server/native-only**
`@his-fm/contracts/prompt-defaults` entrypoint. The shared contracts root exports
only keys, labels, limits and validation, not private prompt bodies.

## Storage, revision and privacy

Migration `0011_prompts.sql` adds `channel_profile.prompts`. Initialization fills
only NULL bundles, preserving existing global content and custom edits. It advances an existing row's version once to fence pre-catalogue executor reuse; a new row starts at version 1.
Owner-only `PUT /admin/api/channel` accepts `version` plus `content`, `prompts`, or
both, and increments one version atomically. A bundle must contain every known
key and no unknown keys. Global content allows 30,000 characters; named prompts
allow 12,000; each Jev question allows 1,500; voice comparison style allows 2,000. Jev still enforces its entire encoded
16 KiB/12-question ceiling, irrespective of configuration text.

The page saves only the selected editor. Before saving it reads the current
bundle, preserving changes to other keys. Changes to the selected key produce an
explicit comparison; races during PUT still fail with 409. Empty/oversized drafts
remain in session storage and cannot be saved. Category prompt writes preserve
current metadata; metadata writes preserve the current prompt. The category's
optimistic version continues to protect both.

`GET /api/agent/channel` is authenticated and read-only. Public discovery exposes
schema and usage, never bodies. Native prepared inputs and assignments snapshot
the exact bundle; replay uses the same snapshot. New inputs and assignments read
fresh settings. Any channel revision change disqualifies old executor reuse;
category revision fencing remains independent. Existing content, approvals,
publication and terminal command states do not change when prompts are saved.

Each compaction reads the current summary instruction. The pinned Pi Durable 1.0
boundary preserves its serialized conversation and optional additional focus,
replacing only the English system/summary instruction. The SDK still owns cut
selection, durable placement, usage and retry; history is never deleted. A format
mismatch fails closed. Low summary reasoning and the pre-generation token guard
remain unchanged. This is distinct from replaying an already dispatched task.

## Code-owned context

These are facts/protocols, not editable policies: tool names, JSON schemas,
parameter requirements, available tools, current owner command, production and
editor snapshots, provider/model capabilities, network endpoints, runtime limits,
receipt validation, optimistic writes, human approval and publication gates.
Application-owned tool descriptions are Chinese and remain next to their enforced
implementations. Pi's native CodingTools descriptions/serialization are owned by
the installed SDK. Editing prose cannot grant new tools or permissions.

Narration style remains in the private native settings store, not copied to D1;
its page discloses that native settings are shared by Local/Prod. Existing custom
styles are never replaced with the translated default, and authorized jobs retain
their original style snapshots.
