# Retrospective

## 2026-10-01 - Avoid zsh's reserved path variable in smoke checks

The post-release route probe used `path` as a loop variable, which overwrote zsh's command-search array and prevented curl and Git from running. The exact-revision health verifier had already passed; rerunning the route probes with `route` confirmed the public pages and agent discovery return 200 and anonymous studio access redirects to Access. Use non-reserved variable names in shell probes, and distinguish a local probe failure from a deployment failure.

## 2026-10-01 - Check emulator types before committing upgrades

The Cloudflare tooling upgrade built successfully, but the commit gate rejected five Miniflare fixtures in runtime tests and typecheck that still supplied the removed `config.type` field. Remove the obsolete discriminator rather than casting around the new schema. For coupled emulator upgrades, run typecheck alongside focused runtime checks before attempting the atomic commit; a successful application build does not validate test fixture types.

## 2026-09-26 — Publish identity resources atomically

The first theme implementation referenced R2 font URLs before their upload batch had completed. A network interruption left many URLs returning 404, and loading the preview could cache those failures. The user also reported missing header/footer wordmarks while the implementation used external SVG symbol fragments. Fonts now ship with the application as fingerprinted same-origin assets, while wordmarks render inline paths generated from the canonical SVG. Keep large imagery on immutable R2 keys and verify its delivery before release; a local asset manifest alone is not evidence of CDN availability.

A build-artifact check initially expected 102 separate font files, overlooking Vite's inlining of three small subsets. Verifying the SHA-256 digests of both emitted WOFF2 files and decoded CSS data URLs accounted for all 102 sources. Check delivered bytes instead of assuming one output file per input asset.

The browser suite also imports the shared theme definitions through Node's ESM loader. Its initial discovery failed because the asset JSON import lacked the required `type: 'json'` attribute. Declare JSON module types in shared modules consumed outside Vite, and distinguish runner-discovery failures from browser behavior.

The first acceptance run assumed the Basalt sidebar rendered links, released an arrow key before Radix's deferred focus handler ran, and tried to inject a frame-load failure after the image was already decoded. Tests now follow the actual button roles, observe selection before key release, and reload before the failure case. Use component semantics and fresh resource state when testing user interactions and network failures.

The existing cover workflow baked a frame into uploaded images. The owner clarified that generated, uploaded and stored covers must remain clean originals; branding belongs only to finished downloads. The production prompt, agent contract, studio upload guidance and export action now share that boundary. Do not infer storage semantics from the appearance of a finished design-study mockup.

## 2026-09-25 — Verify mobile artwork and browser canvas

The initial portrait hero inherited a centered landscape crop, placing the subject outside narrow screens. A transparent document canvas and missing viewport-fit also left Safari safe areas disconnected from the page. Decorative Unicode stars could render as emoji on iOS. The fix aligns the source subject with the mobile golden line, keeps the action clear of the subject, extends the page background through safe areas and uses SVG decoration. Responsive checks now include loaded artwork in Chrome and WebKit, rather than accepting screenshots before images finish loading. The diagnostic initially waited for the About decoration to become visible at a breakpoint where it is intentionally hidden; its check now follows that responsive behavior. Browser emulation does not reproduce physical Safari toolbar chrome.

## 2026-09-25 — Preserve partial patches and durable audio outcomes

The initial partial production schema retained Zod defaults, silently injecting locked brief fields into transcript-only edits. Removing defaults before marking fields optional fixed the boundary, with a regression asserting the exact parsed patch. Partial update schemas must distinguish omission from a supplied default value.

Review also found audio completion wrote the production record and job status separately. A failure between writes could duplicate events or downgrade a completed task after the editor moved to final review. These writes now share a D1 CAS transaction, completion replay is idempotent, and completed jobs reject later running/failed updates. Tests interrupt completion storage and replay after final review.

## 2026-09-25 — Deploy the Vite-generated Worker configuration

The first Release deployment passed CI and remote schema migration, but failed because the reusable deploy workflow explicitly selected the source Wrangler configuration. Vite supplies the asset directory and bundled entrypoint in `dist/his_fm/wrangler.json`; specifying the source file bypasses that generated configuration. The release now selects the build output for both migration and deployment. Validate the exact CI command with a dry run, not just `vite build`, before publishing a release. No Worker was replaced by the failed attempt.

## 2026-09-25 — Bound research reads before drawing conclusions

During the first episode's research, an `fd` command incorrectly supplied two filename patterns, so the second was treated as a directory. The command was corrected to one anchored pattern. Some subsequent combined chapter reads exceeded the output budget and hid relevant text.

No repository content or credentials were affected. Research continued by extracting complete selected entries, including their limitations, and checking the original papers and official case reports. Future research should use one valid filename expression, budget independent reads before batching, and never treat a successful but truncated command as evidence that all requested text was reviewed.

During the editorial revision, a line-bounded chapter read still overflowed because individual Markdown lines were long. Select complete entries by heading and bound the total characters returned; a line count alone does not bound output size. The selected claims were checked against the original study materials before entering the revised manuscript.

## 2026-09-25 — Verify runtime dates and local seed visibility

The initial Worker configuration used the current date, September 25, while the installed Workerd binary supported September 24. The development server rejected startup. The compatibility date was changed to the verified supported date and startup was rerun. Future changes must check the installed runtime rather than infer compatibility from the calendar.

The first local seed also used 08:00 UTC on the current day, which was still in the future during browser validation. Correct public scheduling hid the featured manuscript. Seed dates were moved to a past day, and only the affected local preview record was updated; no remote episode data was created. Local preview fixtures should use past dates unless they explicitly test scheduling.

Chrome trusted the existing local CA, while Playwright's separate Node HTTP client could not validate the local certificate even with system trust enabled. Removing TLS bypass exposed this difference and interrupted temporary-record cleanup. Browser acceptance now uses browser-originated fetches for API assertions and cleanup, exercising the same verified HTTPS connection as the application. Leftover test drafts were removed through that connection. No certificates or Keychain settings were changed.

One gate verification run correctly detected an index change because the coordinator staged files while the preservation probe was still running. Complete staging before starting this probe, and serialize all index mutations until its result is collected. The verification was rerun with a stable index.

## 2026-09-25 — Match browser tests to control semantics

Studio browser acceptance initially targeted Basalt SegmentControl options as buttons, but their accessible role is radio. Inspecting the browser accessibility snapshot identified the mismatch; the test now asserts radio selection through aria-checked. Upload tests also attempted to select files while a preceding save still disabled the picker. Waiting for the actual picker to become enabled removed that timing race. Browser tests must follow the installed component's accessible semantics and visible readiness, rather than infer roles or bypass disabled controls.

## 2026-09-25 — Separate owner workflow from agent review boundaries

The first studio exposed the agent submission protocol as a multi-person editing workflow and erased useful material when reopening an earlier stage. The owner works alone. Owner completion now saves and confirms atomically; owner edits preserve material while invalidating downstream confirmations and media versions. Agent permissions remain restricted. A first revision incremented the script version for an empty initial brief; the lifecycle test caught this, and initial brief edits now leave that counter at zero until content exists. Long-form review must also have a single scroll owner rather than an independently scrolling paragraph inside the content island.

The first stage-navigation stylesheet referenced a success token absent from Basalt 2.1.8. Computed-style inspection caught the missing value; completed stages now use the existing green primary accent. Read installed token definitions and verify actual colors in both themes instead of relying on plausible token names. Native content-sized textareas were also verified in both Chrome and WebKit before retaining the CSS-only implementation.

## 2026-09-25 — Separate narration from optional audio bumpers

The initial cloud audio route required both bumper uploads, preventing a complete approved script from producing narration on its own. Narration is now independently checkpointed and stored; adding both bumpers is explicit. Per-job voice overrides and short owner previews use the same synthesis contract.

Expanding the voice list from six to thirty exposed an unbounded Basalt Select viewport on phones. The installed component supports a custom content class, so the shared studio choice now bounds its native viewport using Radix's available-height variable. Mobile acceptance selects voices near the end of the list rather than testing only the initially visible options.

A browser regression also caught duplicate React roots after Vite invalidation. Declaring lazy components inside the bootstrap made the React plugin inject a timestamped self-import, evaluating `createRoot` twice. Routing and lazy components now live in an exported `App`; the bootstrap only creates the root. The full workflow's page-error assertion is retained.

## 2026-09-25 — Match browser chrome to the active site surface

The public Safari color fix left one public-paper theme-color on admin routes and an unpainted admin document canvas. Admin now uses the installed Basalt background token for the document, body and safe areas, synchronizes theme-color when the provider changes mode, and restores the public color on leaving the studio. Browser acceptance must cover dark mode, reload and client-side navigation between public and admin views, rather than checking only the visible content island.

## 2026-09-25 — Preserve safe provider error categories

A reported TTS HTTP 400 could not be diagnosed from the stored message because the shared synthesis code discarded every provider error body before classification. Default Kore previews succeeded again locally and in production, so that result does not establish the cause or resolution of the reported request. Error bodies are now bounded and mapped to fixed actionable categories; raw provider messages, scripts and credentials remain excluded from logs and responses. Preserve diagnostic categories at the integration boundary and verify the actual failing inputs before claiming a provider failure resolved.

## 2026-09-25 — Make the advertised agent entrypoint usable

The studio copied `/api/agent` for Hermes, but the Worker only implemented subordinate routes and returned 404 at that exact address. Documentation existed only in the private repository, and copied task instructions used a different token environment-variable name from the API guide. Reproduce onboarding from the advertised URL before declaring an integration usable. The service now publishes a standard API catalog, OpenAPI, instructions and authenticated capability/identity endpoints, uses one token variable, and tests discovery through the actual Worker router and bearer authorization boundary.

## 2026-09-25 — Confirm the development server before browser checks

The first browser validation run assumed the previous Vite session was still listening. Every navigation failed because Caddy returned 502. Restarting the existing development command restored the site. Check the local health endpoint before starting a browser suite after a session handoff; an old process reference is not evidence of a running server.

## 2026-09-25 — Preserve document drafts independently of save validation

The initial channel editor reused the server's nonempty, 30,000-character schema to restore browser drafts. That discarded a temporarily empty or oversized draft on reload even though the editor claimed it was retained. Draft restoration now validates only the stored shape and version; publication/save constraints apply when saving. Browser checks exercise both unsavable drafts alongside failed saves and version conflicts.

Document-editor acceptance initially clicked the middle of a paragraph while expecting appended text. Rapid native selection changes also reached the next Chrome key event before the editor received `selectionchange`. The test now explicitly moves to the end and waits for the formatting toolbar to reflect the collapsed paragraph selection before the next command. It does not alter editor internals or use timing sleeps. The real-save scenario also waits for completed login navigation before requesting a protected page, preventing WebKit from aborting the login request. Editor configuration is stable across content updates, and changing editability does not emit a false content update.

The full browser suite exposed an older upload assertion that counted every audio element, including a hidden voice-reference player. Its earlier success could precede the upload response and therefore was not evidence that the uploaded bumper appeared. Acceptance now waits for the visible player with the uploaded media URL.

The first patch to that shared-looking assertion matched the earlier final-review test instead of the bumper test. Reviewing the failing source location exposed the mistake; the final-review assertion was restored and the bumper assertion changed with surrounding action lines as patch context. Repeated assertion text is not a unique patch anchor: inspect the resulting diff before starting another suite.

## 2026-09-26 — Test R2 cursor semantics rather than page size

The first inventory integration test expected a requested 200-object page to contain exactly 200 objects. Miniflare returned 100 because metadata-inclusive responses have a lower page capacity. The implementation already followed `truncated` and `cursor`; the test was corrected to verify complete, duplicate-free traversal instead of assuming page size. Fixture cleanup now follows every cursor too. A scan error must remain distinguishable from an empty bucket, and cleanup stays disabled until scanning completes.

The first full Chrome run overlapped with a focused WebKit run using the same Playwright output directory. WebKit initialization removed Chrome's trace files, causing an `ENOENT` during test-context teardown despite the channel assertions succeeding. Run browser suites sequentially when they share reports, traces or writable local fixtures; parallel execution requires separate artifact directories and independent data. No application code change was needed for this harness failure.

The first staged gate correctly blocked a pagination test whose 205 real Miniflare R2 writes exceeded Vitest’s default five-second case timeout under concurrent browser load. That I/O-heavy case now has an explicit 15-second limit; assertions, coverage floors and the normal commit hook are unchanged.

## 2026-09-26 — Budget hero resolution for physical pixels and cover cropping

The initial 1536×1024 hero looked soft on MacBook Retina displays: its width supplied only 46–53% of the required physical pixels. CDN bytes matched the local file, so recompression was not the cause. A reference-image edit now supplies native 3504×2336 detail, with separately cropped mobile derivatives and immutable CDN keys. Inspect the native file behind `currentSrc`, account for DPR and both axes of `object-fit: cover`, and check composition before publishing. Width-only `sizes` on a tall mobile crop would select an undersized image even with a high-resolution original available.

The browser diagnostic initially compared the serialized object-position string exactly; WebKit returned `61.799999%` for `61.8%`. It now compares the numeric position within a small tolerance. Cross-engine geometry checks should test visual constraints rather than floating-point serialization.

## 2026-09-26 — Keep production stage scrolling inside the content island

Stage navigation used `scrollIntoView` on the step bar. Switching from the manuscript to the brief also scrolled the overflow-hidden application shell by 56 pixels, hiding the breadcrumb header and exposing a bottom gap. Absolutely positioned control labels lacked an island positioning context and could contribute overflow to the shell. The island now establishes that context, and stage changes reset only its own scroll before paint. Browser checks cover all stages, long manuscripts and history navigation at desktop and phone sizes in Chrome and WebKit; shell/header bounds must remain unchanged.

The WebKit sidebar check also exposed that pointer clicks do not always focus the navigation opener. The overlay therefore captured the document body as its return target. Focus the opener without scrolling before opening the drawer; verify return focus after both route selection and Escape instead of assuming Chrome's pointer-focus behavior.

## 2026-09-26 — Keep Markdown source and publication previews faithful

The channel-only rich-text editor hid the Markdown source and had no explicit preview. Its parse/serialize cycle also made it unsuitable as the common editing path for prompt documents and manuscripts containing tables or code. The studio now shares CodeMirror 6 across long Markdown fields, preserves source text through view changes, and checks formatting, undo, failed saves, restored drafts and version conflicts through browser interactions. Presentation modes must never silently rewrite the saved document.

The publication preview rendered only the manuscript, while copying produced a different HTML document with cover and reference footnotes. The preview now uses the exact sanitized clipboard HTML. Verify actual HTML/plain-text clipboard payloads and their rendered preview together.

Replacing editor dependencies left an already-running Vite process serving stale optimized dependency URLs and returning 504 before the login page mounted. Browser checks were stopped, dependencies were reoptimized with a local Vite restart, and the affected checks rerun. After changing installed dependency graphs, verify browser module loading before interpreting downstream UI failures.

## 2026-09-26 — Separate emulator I/O deadlines from ordinary unit tests

During the editor acceptance run the machine load average rose above 90. Tests making real Miniflare D1/R2 calls repeatedly exceeded the default five-second deadline, and a timed-out pagination test left work running into the following cleanup hook. The same unchanged storage and audio behavior failed in the isolated index-snapshot gate. The three emulator integration files now set a bounded 30-second test/hook deadline; ordinary unit-test deadlines, every assertion, coverage floors and commit-hook blocking remain unchanged. Pagination uses this integration deadline instead of a shorter per-case override. Run browser suites sequentially and avoid overlapping them with emulator coverage on a busy development machine.

The rich-clipboard browser assertion initially read a `ClipboardItem` before observing the asynchronous writer's completion, producing `Clipboard data has changed`. It now waits for the copy-success feedback and reads both MIME payloads together. Local profile acceptance cleanup also checks the expected test-written version and marker before restoring content, so a concurrent owner edit cannot be overwritten by test cleanup.

## 2026-09-26 — Let compact controls wrap before compressing labels

The compact task-prompt grid reserved an intrinsic-width copy button beside a shrinkable summary. At narrow widths, the summary collapsed into a vertical column of Chinese characters. The task row now wraps according to its actual available width, keeps action labels intact and gives expanded text a full row. Source material also moved from an unbounded stack of editors to a compact overview and one detail view at a time. Verify narrow widths, expanded prompts and navigation with unsaved drafts when reducing vertical space; shorter headers alone do not establish a usable mobile layout.

The source detail header initially placed its return control in the right-hand action slot. Secondary-page return navigation now sits to the left of the title/subtitle group as an accessible arrow button. Preserve that placement at mobile widths instead of treating navigation as a primary page action.

## 2026-09-26 — Serialize image generation for identity studies

The first identity-art batch used two concurrent high-quality image requests and encountered rate-limit responses. Continuing the queue immediately caused further failures without producing usable assets. The driver now sends requests sequentially, skips completed originals, and records previous attempts before explicit retries. Keep successful artwork intact and reduce request concurrency when the provider limits throughput; a failed generation must not silently become a different model or a placeholder in the design delivery.


## 2026-10-03: Verify cf migration commands separately

The first local startup after converting to cf failed before seeding: `cf d1 raw` accepted the existing `his-fm-local` identifier, but `cf d1 migrations apply` enforced UUID syntax even with `--local`. A successful read did not prove migration-command compatibility. Assigned a dedicated local-only UUID, copied the existing database through SQLite's backup API, retained the original, and compared application rows before browser acceptance. Runtime `_cf_METADATA` naturally changes on access and is not an application-data equality check.

For future CLI migrations, verify each command's validation and persistence root before changing scripts. Never replace a local identity with the production ID or discard existing state to make startup pass. Also check supported upload headers: cf's R2 upload command currently lacks Cache-Control, so the artwork uploader uses the existing REST endpoint with explicit environment credentials and an offline regression test instead of silently dropping immutable cache metadata.


## 2026-10-03: Monorepo paths include data, assets and tooling

Moving the application into `apps/web` initially left the root Hermes Markdown import and archived font URLs at their previous relative depth. Build and Worker tests caught those missing inputs before publication. Update repository-root imports as well as source-to-source imports when moving a workspace.

Miniflare also chooses `.wrangler/cache` when a workspace has no local node_modules directory, even without any Wrangler dependency. Set `MINIFLARE_CACHE_DIR` explicitly to `.cloudflare/cache` before local CLI startup and tests. Migrated all persisted files with hash verification before deleting the original data directory; do not confuse disposable runtime caches with D1/R2 data.

The shared base-ci installer requires a lockfile in its installation directory. Keep one npm workspace lockfile at root and run the workspace-aware deploy script there rather than copying lockfiles into applications. Preserve exact CLI version checks and version/revision live verification across this change.

## 2026-10-03: Delayed selection events must not retarget page context

The page-context design prototype initially let every browser `select` event replace the active editor target. An asynchronous selection event from the previously edited title arrived after focus moved to the intent field, so a request for the intent incorrectly entered the title's unsaved-draft flow. The browser regression caught this before any production implementation. Accept selection updates only from the active editor, clear cross-field selection on actual focus changes, and preserve the last valid editor selection when focus moves to chat. Pin each command's target and draft revision instead of reading mutable current-page state when its reply arrives.


## 2026-10-03: Verify generated architecture artifacts without guessing viewer APIs

The first Archify candidate exceeded its desktop readability budget and placed two edge labels over nodes. Its structured diagnostics identified the exact labels and viewBox constraint; compacting the canvas and moving only the diagnosed labels produced 9/9 showcase checks without deleting semantic relationships. Keep candidate geometry changes in the JSON source, never patch the generated HTML.

A supplementary browser test initially assumed an unsupported `data-diagram-type` attribute and a guessed reset button label. Inspect the delivered artifact's actual DOM and focus controls instead of inferring its runtime API. Delivery receipts, browser containment checks and visual inspection are separate evidence; none proves that the proposed agent system is implemented.

## 2026-10-03: Give each development WebSocket upgrade exactly one owner

The first complete agent browser run exposed a development-server crash when the environment switch opened the production proxy socket. Both the custom proxy and the Cloudflare Vite plugin listened to the same Node `upgrade` event. The plugin dispatched that proxy request into a custom Node service, where Miniflare asserted that an HTTP response existed for an upgrade. Unit tests had mocked only the proxy and missed the competing handler.

Route the one fixed production-proxy path exclusively after all Vite configure hooks register their listeners; delegate every other upgrade to the original handlers. The regression now proves that the fixed proxy socket is not also dispatched to the Cloudflare handler and that unrelated/HMR sockets retain their original path. Validate Local/Prod navigation on a real development server, not only isolated proxy mocks. Never swallow the runtime assertion or label the resulting 502 cascade as an application test pass.

## 2026-10-04: Delegate outcomes and verify execution rather than reports

A coordinator carried a previous smoke task's CLI restriction into a later research assignment. The executor had native bash but returned a zero-page report without trying it. The first repair described the available network tools, yet still centered the policy on that one failure. The policy now delegates outcomes and method selection across research, data processing, scripting, diagnostics and verification. Each immutable assignment carries the current owner command and actual capabilities; earlier task limits remain scoped to their original request. Website permissions and human approvals remain enforced by tools and controllers.

An immutable Markdown report proves that a report exists, not that the requested work succeeded. Structured outcomes, inspected evidence, fixed acceptance counts and website receipts now govern task completion. Regression checks execute both loopback retrieval and local data-processing scripts through real executor tools, including a reviewer, while fake models keep routine tests offline. Live-model acceptance remains separate evidence of model behavior.

During recovered acceptance, an initial whole-object readback assertion compared the agent client's narrowed approval projection with the owner's full response, and treated the expected edit audit event as an unrelated mutation. Compare shared content fields exactly, validate approval values semantically across response projections, and check the expected audit append separately. The corrected check confirms only source content changed; all approvals remain empty.

## 2026-10-04: Match optimistic message IDs to canonical echoes

Sending a chat message displayed two identical bubbles although the website stored only one command. The client used `user:<commandId>` for its optimistic message and offline restoration, while both the live server echo and snapshot used the command ID itself. The reducer correctly merged by ID but therefore treated those messages as different. Both client paths now use the canonical command ID.

The previous browser fixture acknowledged commands without echoing their messages, so its one-frame assertion missed the duplicate display. Regression checks now cover the actual acknowledgment/echo sequence, offline restoration, repeated deliveries and reconnect snapshots. Explicitly sending identical text twice still produces two distinct commands; content-based deduplication would hide legitimate messages.

## 2026-10-04: Verify compact role cards with long task text

The first compact role-card pass used a fixed two-row grid but inherited wrapping from the button, letting a long task spill into a second line. Dark-theme visual inspection exposed it even though the roster height remained bounded. Task summaries now explicitly stay on one ellipsized line, with complete content in a keyboard-accessible Basalt Popover. Test both fixed geometry and actual text overflow when conserving vertical space; a height assertion alone does not prove legibility.

## 2026-10-04: Preserve Basalt control typography

The admin-wide `font: inherit` reset overrode Basalt's layered typography utilities. The Local/Prod segments rendered at 14px and weight 400 despite the installed component specifying 11px and weight 600. Inherit only the font family and let Basalt own control sizes and weights. Check computed typography against the installed package on desktop and phone; using a library component alone does not prevent consumer CSS from overriding its design.

The verification gate also exposed the native harness tests' implicit one-second polling deadline under concurrent local load. The suite already allowed 15 seconds per test, but that did not extend `expect.poll`. Set a bounded ten-second polling deadline for asynchronous runtime assertions without changing the tested outcomes, coverage floors or hook enforcement.

## 2026-10-04: Verify native speech end to end

Moving provider calls out of the Worker required more than a local synthesizer: job dispatch, native assignment decisions, credential-free status reads, fenced binary upload and one transaction for speech/job/production completion must all work together. A serialized Hub operation could wait for a settings reply that was queued behind itself; allowlisted runtime replies now resolve outside that operation queue and are bound to the active station generation. Cache serialization also differed between native and website field order; one canonical shared encoding now defines the digest.

Live verification found Falcon was not running and the owner's ElevenLabs library voice required a paid account. Starting the existing decision service restored dedicated conversations; verified default voices generated real eleven_v4 comparison samples without silently changing the configured voice or model. Test provider execution separately from account-specific voice access, and require successful website receipts before claiming delivery. Pure codec/provider tests moved with their code instead of disappearing with the removed Workflow.

## 2026-10-04: Measure contrast on tinted provider surfaces

The initial provider-card tint used the same 20% accent overlay in both themes. On dark surfaces, existing muted text fell below 4.5:1 even though the original Basalt tokens were accessible. Reduce the dark-theme overlay to 14%, verify text against the composited gradient endpoints, and retain visible provider names alongside logo and color. Token reuse alone does not establish contrast after compositing.

## 2026-10-05: Compare paired cards and matching speech inputs

Provider branding retained the shared grid's `align-items: start`, so different form lengths produced visibly unequal cards. The flat sample list also put unrelated providers next to each other. Provider cards now stretch to their row height, and explicit voice pairs keep Gemini left and ElevenLabs right with shared subgrid rows for media and actions. Regression checks cover desktop, tablet, phone, empty samples and populated comparisons.

New Gemini requests failed because its public API was unreachable and the configured local proxy was not running. Do not relabel old audio as newly generated or silently mix delivery styles. Verify the baseline's original request, use its exact fixed text/style for the other provider, and identify the benchmark separately from editable studio defaults. Three matching ElevenLabs samples completed with real receipts; failed Gemini attempts remained failed.
