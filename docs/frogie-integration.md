# Frogie integration

## Ownership

Frogie owns `squads/hisfm/`: the coordinator, writer, reviewer and speech roles, all sixteen named prompt defaults, the channel policy and narration style. Its parity tests preserve the original effective text and role assembly order.

his.fm owns the resident process, authentication, Jev scheduling, website tools, approvals, speech scripts, UI, transport receipts and local storage. Native execution uses `@frogie/core/host`. Pi Durable, Pi AI and Chord are transitive implementation dependencies of Frogie; application code and tests import Frogie instead of those packages.

The Worker imports only `@frogie/core/hisfm/prompts`, a generated pure-data entrypoint without Node or Pi runtime imports. The shared speech config imports only `@frogie/core/hisfm/narration`, which contains the public narration default rather than the private prompt catalogue. Existing D1 channel/category edits remain authoritative business configuration. Defaults initialize missing values; adoption does not overwrite saved prompts. Each command and assignment retains its immutable configuration snapshot.

## Native adapter

`packages/agent/src/runtime.ts` registers typed business tools with `defineHostTool`, opens the definition using `openAgentHost`, and selects models from the existing private configuration. `host.transact` atomically updates assignments and creates or configures conversations. `host.run` submits a stable request ID; repeated inputs reconnect to the original durable submission. Separate conversations run concurrently.

Before `host.resume()`, the application reads `pendingSubmissions()` and persisted assignments, calls `stageAbort()` for cancelled, terminal or expired work, and restores the exact active command context. These preflight operations do not start scheduling. The Host owns conversation persistence, role tool selection, context compression, cancellation and Node execution cleanup. The application owns command acceptance, task lifetimes, result validation, fenced website effects and human-only gates. `finish_command` still requires evidence and successful receipts.

Writer and reviewer have trusted local CodingTools. Speech has only the dedicated generation and result tools. Work directories are per conversation; this is not an OS sandbox. Credentials remain in the private native config and outside prompt snapshots.

## Storage

The existing website-origin/station identity determines the runtime directory and exclusive process lock. New execution data uses `frogie.sqlite`; `transport.sqlite` retains command history and effect receipts. `pi.sqlite` remains untouched as historical data.

Tool operation, proposal, assignment and visible-message IDs include the persisted Frogie runtime identity. Native work directories use `workspaceRoot/frogie/runtimeId/conversationHash`. A new execution database can therefore allocate fresh numeric Pi IDs without colliding with historical receipts, old files or a different website's runtime.

When the old execution database exists and the Frogie database does not, startup rejects unfinished legacy commands or pending transport events. Resolve those explicitly before switching execution. Terminal commands remain terminal; they are not replayed into the new Host. New Frogie sessions reopen using the same runtime identity and bound definition.

`npm run agent:debug` reads transport status and Frogie tool diagnostics without starting models or exposing prompt bodies. Routine unit tests use isolated state and `@frogie/core/testing` model fixtures.

## Updating the package

Use Node 26 or newer. Build the selected Frogie revision with `pnpm build:core`, then run `npm pack` inside its `packages/core` directory. Place the versioned tarball in this repository's `vendor/`, update the agent, web and contracts workspace `@frogie/core` dependencies, and refresh `package-lock.json` through an allowed registry.

The tarball contains compiled JavaScript, declarations and the exact Squad snapshot. A fresh his.fm checkout installs independently of a neighboring Frogie checkout. Commit the artifact, manifest and lockfile together after verification. The native and Worker entrypoints must resolve to the same package version.

Run `npm run lint`, `npm run typecheck`, `npm run test:coverage` and `npm run build`. Live acceptance uses the enrolled Local product agent, a newly named production and the existing owner approval endpoints. Verify topic research, refinement, script, audio job completion and playable WAV bytes; keep existing productions unchanged and publication separate.
