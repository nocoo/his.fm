# Local agent development and debugging

These commands operate on Local only. Production keeps its separate daemon, station token and SQLite namespace.

```sh
npm run dev:all
npm run agent:debug
npm run agent:debug -- --command COMMAND_ID
```

`dev:all` validates the loopback website, waits for migrations/startup, starts a missing Local coordinator and waits for it to connect. A matching already-running website/coordinator is reused. Ctrl+C stops only child process groups this invocation started; it does not stop reused processes, delete databases or change production credentials. The local token/station must already be configured as described in [native onboarding](native-agent.md).

`agent:debug` reads `transport.sqlite` and `frogie.sqlite` without opening the Frogie Host or calling a model. It reports command states, pending inputs/effects and bounded tool-call counts/error counts; it does not print prompts, draft text, command arguments, tool output or credentials. With `--command`, the command/input tables are filtered; the tool summary is explicitly the last 1,000 tool results across conversations, not falsely attributed to that command. The preserved legacy `pi.sqlite` is outside this command's scope. See [Frogie integration](frogie-integration.md) for storage and adoption rules. `--environment production` is an explicit read-only diagnostic mode, not a process start or mutation.

For source-level breakpoints, stop the Local coordinator first, then run:

```sh
npm run agent:inspect
```

This uses the reserved loopback inspector port `127.0.0.1:37056`. Attach Chrome's Node inspector locally. The debugger can inspect process memory, so keep it loopback-only and close it after debugging. The normal instance lock rejects a second coordinator; inspection never silently takes over an active process. Source changes apply on restart, while persisted command/conversation identities are retained.

## Multi-stage acceptance

Use an explicitly named Local acceptance episode, retaining the real first episode untouched. A useful regression task reproduces the previous GitHub failure while adding measurable completion criteria:

1. Read at least 21 distinct Markdown source files through real GitHub HTTP/CLI requests at one pinned commit. Save a local manifest of canonical URLs, paths, response/content hashes and retrieval counts. Count only successful distinct content, not guessed links or a repeated raw/blob URL.
2. Select relevant facts, translate the core ideas into Chinese, and classify the sources into at least three useful editorial themes. Ask a separate reviewer to verify counts and samples against the local retrieval manifest.
3. The coordinator inspects writer and reviewer results, checks each explicit criterion, then appends only the new source records to that Local production using its current version. Preserve existing IDs and fields.
4. A second user command asks for an outline/revision based on the same episode. Check that a compatible task conversation can be reused through Jev and that the new goal has its own immutable scope.
5. A deliberately unavailable source should produce a blocked/incomplete outcome with actual attempted evidence; a Markdown failure report must not become a completed research task.

Keep live-network acceptance separate from automated tests. Unit tests use fake models/transports and temporary SQLite; their job is to prove scope, outcome and receipt rules deterministically. Screenshots made by UI tests are acceptance evidence only, never an agent screen-collection capability.
