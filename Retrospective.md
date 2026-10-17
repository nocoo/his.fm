# Retrospective

## 2026-10-16 - Verify the v2.4.0 retirement cutover

Release v2.4.0 deployed source revision `ac3dc04fd4cde841e984e1460e1d1157c3cff6e2` through successful CI run `38835389473` and Release run `38835591256`. Migrations 0014/0015 completed and Cloudflare confirmed deletion of AgentHub. Pre/post canonical digests match for preserved productions, episodes, categories, bumpers, saved prompt bodies and appearance. The D1 Time Travel bookmark and verification evidence remain ignored under `.local/releases/v2.4.0/`. Public routes, discovery, exact live revision and anonymous management rejection passed; authenticated production acceptance remains pending because the cached Access session expired.

The first standalone route-probe snippet mixed CommonJS `require` with top-level `await`, so Node rejected it before any request. Rerun with explicit `--input-type=module` and ESM imports, and distinguish a local verifier startup error from a production failure. All twelve corrected read-only probes passed.

## 2026-10-16 - Wait for the destination form during lazy navigation

The full browser run timed out waiting for episode creation because the title was empty. The trace showed the title fill targeted `#production-title` on the previous brief page after the URL had changed, before the lazy episode editor mounted. Wait for the destination `#episode-form` before filling labels shared by both screens. URL changes and completed clicks do not prove a React transition has replaced its previous view; keep the original timeout and verify the entire workflow instead of retrying around the race.

## 2026-10-16 - Validate remote lifecycle before retiring a Worker export

Local build and deploy dry-run passed after removing `AgentHub`, but neither proved that Cloudflare would accept the existing provisioned namespace without an export entry. Read-only production inspection and current platform documentation exposed the missing deletion tombstone before migration or deployment. Obtain explicit deletion authorization, declare the tombstone only for production, and capture a D1 recovery bookmark before cutover. D1 backups cannot restore Durable Object state, and a previous Worker cannot be safely rolled back across a lifecycle deletion or the retired SQL tables.

The follow-up artifact assertion initially guessed a nested `config.json` path. Discover the emitted files and inspect `workers/default/worker.config.json`; the root `config.json` contains only build context. The corrected assertion verified the production deletion tombstone and absence of the runtime binding after the build and dry-run succeeded.

The staged typecheck then rejected `local ? {} : { AgentHub: ... }`: inference added an optional undefined member incompatible with cf's export record. Omit the optional exports field with `undefined` in development instead, without casting away the error, and assert both modes in the existing configuration test. A successful build does not replace strict typechecking of typed configuration.

## 2026-10-16 - Recheck route fallthrough after merging subresources

The remote audio-binding merge introduced a nested `/assets/audio/bind` route, but the existing broad `assets/` DELETE branch also matched it and could detach audio on a POST-only endpoint. Restrict detachment to the two exact asset paths and assert that other binding methods return 405 without changing the production. Reviewing only the added POST handler misses existing sibling routing behavior. The integration also retains staging source bytes when D1 rejects a binding, rather than deleting the original before the versioned write succeeds.

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

## 2026-10-05: Preserve explicit proxy settings in speech subprocesses

Gemini retry tasks reached the dedicated product conversation but their Node subprocesses could not connect directly to the provider. A credential-free request succeeded through the machine's configured loopback proxy. The subprocess environment allowlist omitted both proxy variables and Node's proxy opt-in, so configuring the coordinator alone could not fix generation. Forward only explicit HTTP/HTTPS proxy settings, bypass rules and `NODE_USE_ENV_PROXY`; keep provider keys and `NODE_OPTIONS` excluded. Verify the repaired path by resubmitting the same authorized website jobs, not by generating artifacts outside the product agent.

## 2026-10-05: Evolve category consumers with their stored identity

Turning four hardcoded categories into managed editorial profiles required updating both UI choices and the episode CHECK constraint, public labels, machine contracts and native assignment inputs. Updating only the prompt endpoint would leave actual delegated writing on the global prompt alone. Keep stable IDs, separate public metadata from private prompt bodies, and exercise the real coordinator-to-writer assignment in addition to HTTP prompt tests. Browser verification also confirmed IconPicker exposes radio choices rather than options; tests must follow installed component semantics.

Live category acceptance exposed a separate runtime limit: the writer produced and verified the requested manuscript, but the long-lived coordinator failed to compact its history because summaries hit the model token limit, then timed out. Record writer delivery and coordinator acceptance separately. Preserve the artifact and terminal failure, clean up only owned test records after tasks stop, and do not report a successful end-to-end run or silently clear durable history to obtain one.

## 2026-10-06: Apply the workspace theme before loading React

The shared route-loading screen used the public site's light paper background, while Basalt styles and ThemeProvider arrived only with the lazy admin module. A saved dark preference therefore still flashed light during startup. Load the existing Basalt stylesheet through a render-blocking HTML link, resolve the same `hisfm-theme` preference before mounting React, and keep the route-loading canvas on Basalt tokens. Public appearance remains separately scoped.

The first implementation read the canvas color from an inline head script, but Vite moved the built stylesheet after that script. Place initialization at the start of the body, after head styles and before visible content. Verify both development and built assets while independently delaying React and the admin chunk; checking only the settled dark page misses the regression. Cover explicit preferences, system defaults, invalid values, denied storage and public/admin navigation. Assert browser-normalized colors rather than guessed HSL-to-RGB rounding.

## 2026-10-06: Reserve answer space after durable compaction

The local coordinator's retained history reached an estimated 123,908 tokens in its configured 128,000-token window. Summaries inherited high reasoning and repeatedly ended at their 8,192-token output ceiling. Pi Durable 1.0 continued after failed threshold compaction, and pi-ai reserved 4,096 tokens then clamped the remaining negative budget to one output token. The gateway rejected that request with HTTP 400; the application hid it behind a generic connection message.

Keep the SDK's durable summary selection, accounting and placement, but use low reasoning only for summarization on the same model. Guard task requests before provider dispatch, preserve room for output, and report unsuccessful compaction explicitly. A private SQLite backup of the failing session compacted successfully with one real summary request: 123,908 estimated tokens became 23,473, with a durably placed checkpoint and all original entry hashes unchanged. Fake-provider regressions cover successful compaction, continued high-reasoning execution, reopening without regeneration, truncated/empty/error summaries and zero dispatch when the budget remains exhausted. Do not clear conversation history, silently enlarge the model context, or replay failed content commands as a recovery shortcut.

The acceptance script initially omitted the required context argument to `Harness.close`; the summary had already been committed, but cleanup reported an error. Reopen the same copy without model calls and verify its checkpoint rather than repeating paid summarization. Use the installed declarations for transaction writes (`appendEntry`, not the read-only `entry`) and lifecycle calls.

During adoption, two assertions caught incorrect SDK assumptions: summary content is a text-block array, and `configure({ extensions: { remove: [...] } })` replaces the selection rather than subtracting from a stored explicit list. Normalize the stored content and restore the exact original extension selection, not an assumed inverse change. The complete agent configuration was verified against the backup before restarting; the temporary extension never remained active in the running coordinator. Reuse a verified summary only after exact history comparison and cut-boundary checks, and retain a private backup before placing it.

## 2026-10-06: Editable editorial policy did not cover runtime instructions

The global prompt editor exposed channel positioning, but coordinator/executor,
Jev, network and compaction instructions still came from English literals. Stage
prompts also mixed hardcoded Chinese and English. Editing the global page could
therefore not change those behaviors, making the configuration surface misleading.

The correction introduces a private versioned Chinese prompt catalogue, connects
actual runtime/production/summary consumers, and centralizes category and narration
editing without copying their stores. Immutable assignments preserve the exact
bundle while subsequent tasks refresh it; changed revisions fence executor reuse.
Tests must verify model inputs and replay, not merely a successful settings save.
Private defaults use a dedicated non-browser entrypoint, and permissions/protocols
remain enforced by code rather than configurable prose.

During local acceptance, the inventory also found the voice comparison style in a
separate shared module. It now has a saved Chinese prompt while the old English
string remains only as archived sample provenance; no paid samples were recreated.
Local SQL inspection initially used an unsupported `cf d1 execute`/`query --local`
path. Both failed without writes. Existing seed scripts establish `cf d1 raw
--local --persist-to .cloudflare/state` as the supported path; inspect the repository
commands before assuming another CLI's subcommands are available.

## 2026-10-06: Inspect open controls and intermediate viewport widths

The prompt catalogue passed editing tests, but its narrow trigger also dictated
the dropdown width. Ordinary Chinese labels wrapped into tall rows. The shell's
phone-only breakpoint left three columns at 768px, squeezing the editor below
200px. Closed controls and desktop/phone checks did not expose either problem.

Size shared select menus by their content within viewport bounds, retain single-line
triggers, and use Basalt groups for the prompt catalogue. Keep one header and one
active save action without unmounting independent drafts. Use drawer navigation
below 1200px and stack the coordinator below 1024px without replacing its session.
Regression checks now open menus in both themes at 320, 393, 768, 1024 and 1440px,
exercise long labels and keyboard focus, and resize live drafts across breakpoints.
Keyboard tests must wait for the selected option to receive focus after opening
the Radix portal before sending the next arrow key.

## Compiled host adoption

The first migration checks covered native agent tests but missed a contracts test
that still imported the deleted prompt source. The complete workspace typecheck
caught it. Run root workspace gates after moving shared assets, and validate the
installed package rather than only its sibling source. New package exports also
require refreshing the live Vite module graph before product acceptance; preserve
durable commands instead of resubmitting when the local server reconnects.

Recovery preflight must run before scheduling. Pi conversation abort itself starts
scheduling, so cancelled or expired native tools could otherwise resume first.
Frogie's paused inspection and staged task cancellation now fence this boundary;
regressions verify cancelled root inputs and expired executors without new model
calls, alongside a normal recovery control.

A new execution database restarts numeric task and conversation IDs. Keeping the
transport database and workspace root while deriving IDs only from those numbers
could reuse historical receipts or files. Scope external IDs and work directories
by the persistent runtime identity; a regression seeds old success receipts and
messages and verifies that new operations execute once without modifying them.

## 2026-10-15: Scope integration needs executable contracts

The inherited Herdr environment named a different workspace from the active
his.fm pane. A split briefly appeared in that other workspace and was closed
immediately, without starting work there. Resolve the actual project pane from
the agent inventory and use explicit workspace/pane IDs for every operation.

Adding episode validators to OpenAPI initially failed at runtime because Zod
output JSON Schema cannot represent date transforms. Generate request/input and
response/output schemas deliberately, and invoke the complete OpenAPI generator
in a regression test rather than relying on TypeScript alone.

Scoped writes also require response projection: an audio-only or write-only token
must not receive an existing transcript or catalog entry through a mutation
response. Review success bodies, cached receipts and nested prompt/publication
fields together with endpoint authorization, not only GET handlers.

Read attenuation alone does not isolate a resident coordinator's retained history.
Frogie's shared scheduler may drain work outside the caller's async-local context,
and resume can schedule every restored conversation. Authorize explicit command IDs
before reuse/recovery, stage denied work for cancellation while paused, and authorize
all contributing commands before compaction. Until roots and resident histories are
separated by immutable origin, require explicit shared-history authority rather than
claiming low-scope task isolation.

Independent review caught issuance checking only the authenticated issuer snapshot:
a child inserted after an ancestor's cascade revocation could remain valid. Fence
issuance in the INSERT itself using live grants, expiry and revocation state. It also
caught approval implicitly reopening stages despite a separate reopen scope, and
bumper mutation responses returning old media metadata to write-only callers. Test
each grant alone, not just full-owner workflows, and test stale authentication
against commit-time authority changes.

## 2026-10-15: Release from the deployed baseline

The local manifest was already 2.2.1, but production and the latest published tag
were still 2.2.0. Checking only the current feature's two migrations understated
the release's four pending migrations. Compare the deployed revision and published
tag before writing release notes or describing migration impact. Remote dependency
updates also diverged from local work; obtain merge authorization, preserve the
compiled Frogie boundary and validate the merged dependency graph before publication.

The first allowed npm mirror returned no metadata for a selected Vite version,
surfacing as an apparent peer-resolution conflict. Verify the exact version through
another allowed mirror instead of forcing installation or disabling peer checks.

## 2026-10-15: Verify tables inside the real studio width

The first token-table layout passed page-overflow checks but placed its action
column outside the visible desktop island while the coordinator was expanded.
Inspect the actual shell screenshot, not just viewport dimensions. Combine related
metadata and assert that the desktop action column stays inside its scroll container.
Portaled forms also need the same application spacing tokens as the island; keep
those tokens on the admin document root instead of only on the shell wrapper.

## 2026-10-16: Retire execution without reviving invalid authority

The first retirement SQL filtered JSON values without preserving all invalid grant
states. Shape hardening retained non-text elements, but independent review then
found duplicate retired grants could disappear and turn a previously rejected
token into a valid one. Migration 0015 now preserves the old array-size and
uniqueness rejection boundaries as well as JSON types. The regression includes
object/null/nested values, duplicate retired grants, oversized arrays and all 40
formerly valid scopes. Permission migrations must preserve rejection, not merely
remove obsolete strings. Invalid-token metadata also uses JSON serialization,
not object String coercion that can throw and disable the cleanup list.

Local migration had already run after a stopped-server state backup when these
edge cases were found. A read-only audit of that backup found one token and zero
malformed shapes, non-text elements, duplicate grants or oversized arrays, so no
local token restoration was needed. Production was not touched. The fresh-import
script also still wrote the retired job field after migration; remove obsolete
writers together with schemas, not only existing stored fields. Future deployment
must coordinate the destructive migration with Worker cutover and a restorable
backup; deploying an old Worker alone is not a database rollback.

## 2026-10-16: Verify real playback and rapid CMS interactions

Native controls did not establish working seeking: Chrome needed a real seekable
byte range, not merely known duration. Public and private media now share range
streaming, and custom-player browser checks assert forward/backward drag,
keyboard, real touch and cancellation. The exact reported image-drag symptom was
not reproduced by the initial native-control diagnostic; it should not be claimed
as independently proven. The replacement prevents artwork dragging explicitly.

Native volume/rate change events arrive asynchronously. Rapid mute/unmute then a
keyboard volume change exposed stale controlled state. Update user-initiated
control state synchronously while retaining native-event synchronization, and
keep the rapid sequence as a regression rather than adding test waits.

The new library initially sorted differently formatted ISO timestamps as strings
and lost a just-selected layout when another filter ran before deferred router
rendering. Compare parsed instants and compose query changes from current browser
history. Old sidebar CSS also owned shell geometry; remove the obsolete wrapper
and retain the actual Basalt layout, rather than preserving a hidden retired-style
dependency. Browser acceptance checks actual rendered geometry and rapid actions.

Vite's stale optimizer returned 504 after new granular controls were imported.
Verify installed exports, then restart the existing owned server after backing up
and testing pending migrations; do not replace supported controls to mask a dev
cache problem. Synthetic incomplete HTTP uploads also need a closed test
connection before its reuse, otherwise the next request is consumed as the
previous declared body. Local backup inspection uses the installed modern SQLite
runtime; the system Python's older SQLite and tarfile APIs were not assumed after
their first incompatible calls. A verification wrapper also attempted to assign
zsh's read-only `status`; rerun it with exit-preserving `&&` rather than confusing
a shell wrapper failure with the check's result. None of these diagnostics requires
credentials, private configuration, production requests or starting an extra server.

Removing the native workspace changed dependency hoisting: Node declarations now
live under the web workspace, so the reduced gate fixture could not typecheck
while the real workspaces passed. Point the isolated fixture's type roots at the
installed declarations, including Vite's explicit client entry outside `@types`.
Keep complete failed-check output instead of truncating away the diagnostic.
Reuse real dependencies without mutating their shared directories, weakening
compiler settings or treating a failed healthy control as rejection evidence.

## 2026-10-16: Keep framework action identity explicit

The repository action used a branch symbol instead of the GitHub mark. Lucide v1
removed brand icons, but that does not justify substituting an unrelated symbol.
Reuse the family's attributed GitHub paths and keep icon-only actions labelled
and keyboard-discoverable. Keep the website shortcut prominent in the sidebar,
including the mobile drawer, rather than mixing it into framework header actions.

The standalone RadioGroup wraps its root in a fieldset; its className only styles
the inner radio group. The appearance selector therefore retained the browser's
default outer border and padding. Reset the page's grouping fieldset rather than
removing selected-card outlines or keyboard focus indicators. Check the actual
rendered component wrapper when an unexplained border surrounds library controls.

## 2026-10-16: Verify merged contracts and browser paths

The upstream site-publication change added a platform to runtime routes but not
the OpenAPI path enum, and changed the default form platform while an existing
browser test still assumed WeChat. Reuse the shared platform list in discovery
and test both the URL-free site request and explicit external-platform selection.
A passing unit gate is not evidence that merged browser interactions still work.

For focused browser checks, invoke the web workspace script directly. Passing
`--grep` through the root npm wrapper caused npm to consume the flag and collect
zero tests; the corrected command uses `npm run test:e2e --workspace @his-fm/web
-- --grep ...`. Never count an empty collection as verification.

## 2026-10-16: Test the library's minimum sidebar width

Moving collapse into the header worked at the default width but clipped the
button at Basalt's supported 180px minimum: its right edge remained at 224px.
Let brand metadata wrap within the available space while preserving the logo
and action targets. Browser checks must resize the rail and exercise Enter,
Space and restored focus, not only inspect the default desktop layout.

Basalt 3.1 supplies the standalone fieldset reset that previously lived in the
appearance page. Remove that duplicate only after verifying the actual packaged
styles and browser geometry; retain selection and visible keyboard focus checks.

## 2026-10-16: Handle every React callback-ref cleanup path

The native reveal's reduced-motion branch returned without a cleanup function.
React 19 then called the ref with null during StrictMode replay or detachment,
and the original non-null implementation crashed. Accept null before any DOM
access and capture the narrowed node in a const for asynchronous cleanup closures.
Verify reduced-motion mounting and route changes with page-error assertions,
not only animation appearance in the default preference.

## 2026-10-16: Keep browser checks stateful and artifacts available

After Escape dismissed a tooltip, a viewport change left its trigger focused.
Calling focus again did not emit a new focus event. Move focus away and return
through the real Tab order before asserting the tooltip reopens. Likewise,
inspect or copy screenshots before the next Playwright invocation: it recreates
the output directory, so an earlier successful capture may no longer exist.

## 2026-10-16: Bound isolated test-runtime concurrency

Unbounded machine-derived Vitest parallelism intermittently timed out different
Worker or CLI-spawn tests. After a clean install, the run created 28 isolated
workers across files with roughly 3.72 seconds of startup per file; 271 tests
passed but the CLI fixture exceeded its unchanged five-second deadline. An
earlier full gate also exceeded its outer timeout, while focused tests passed.

The complete web suite passed with four concurrent workers in 4.95 seconds.
That warm result is not a controlled cold-start benchmark. Cap concurrency using
Vitest's native setting and verify the clean-install path again; do not raise
deadlines, share fixture state, skip tests or lower coverage to hide contention.

## 2026-10-16: Assert rendered Basalt contracts after upgrades

Basalt 3.1 moves segmented indicators with transforms, so their offsetLeft stays
zero even when the rendered selection is correct. Compare visible indicator and
selected-item geometry, including width, rather than the previous positioning
implementation. Its documented segmented text is now 12px with 0.025em tracking;
update the browser baseline to 12px and 0.3px, retaining weight, font, selection
and responsive assertions instead of overriding the package back to 11px.

## 2026-10-16: Distinguish page titles from authored headings

The merged public Markdown reader preserves document headings, including an h1
inside its article. Browser tests that selected every level-one heading became
ambiguous between the page introduction and authored content. Scope page-title
checks outside the article and independently verify its heading and safe source
link. Do not discard authored structure or use first() to hide ambiguous matches.

## 2026-10-17: Preserve the development module pipeline under Worker-first SSR

Changing asset routing from SPA fallback to universal Worker-first routing made
Vite's `/@vite/client` and `/@react-refresh` requests return public 404 HTML.
The initial Chrome check exposed the broken module pipeline. Explicitly pass
local development module paths through to assets, then check hydrated navigation
and page errors alongside JavaScript-disabled HTML. HTTP success alone does not
prove that the development app is usable.

## 2026-10-17: Validate historical durations before tightening feed output

The current editable episode schema uses integer seconds, but published data
contains fractional durations. Rejecting those values would silently omit valid
duration metadata. Inspect persisted public values and normalize finite positive
seconds by rounding; never infer duration from enclosure bytes. Regression tests
cover the actual fractional values as well as invalid and missing durations.

## 2026-10-17: Match routing and freshness across the SSR boundary

Independent review found that strict Worker path matching disagreed with React
Router's trailing-slash handling, producing 404 metadata for valid pages and a
different login hydration tree. Redirect public trailing slashes before shell
selection. The original bootstrap also skipped fetching on every later public
mount, replaying stale data after studio edits. Keep the snapshot for hydration
but revalidate on mount, with a browser regression for public-to-login-to-public
navigation that does not reload the document.

## 2026-10-17: Separate directory RSS formats from website playback

The initial feed validation accepted WAV because the CMS and browser player
support it. Apple's RSS requirements accept MP3/AAC; WAV support belongs to its
separate subscriber-upload workflow. Keep website WAV playback unchanged, but
omit WAV enclosures from directory RSS and document the need for an MP3 upload.
Verify delivery-channel requirements instead of equating playable audio with
directory-compatible audio.

## 2026-10-17: Keep browser API fixtures on the public SEO contract

The full browser suite exposed fixtures left behind by the earlier SEO merge:
player tests returned private Episode objects without required `pageSeo`, the
source-navigation assertion expected the retired slug-only route, and the sidebar
inventory omitted the new SEO entry. Project mock episodes through the same
public projection as the API and assert the current canonical routes and complete
navigation. Do not add production fallbacks for malformed test fixtures.

## 2026-10-17: Preserve the complete cover composition, not only its frame

The initial design adaptation removed title slots with decorative copy and placed
the source in a generic square. This lost the designs' artwork windows and left
the finished cover without its real title. Export static decoration separately
from dynamic metadata, and share crop/text geometry between public previews,
studio previews and the PNG renderer. Validate real Chinese fonts, actual text
and phone layouts against the archived studies, not only image loading or bounds.
Owner review also caught a light seam from coincident image/frame edges and a
top-heavy Window Seat title. Bleed artwork beneath the mask and measure visible
glyph bounds; SVG font boxes alone do not prove optical centering.
Long-title review then exposed action overlap and clipped WWDC/MWC lettering.
Reserve the action's horizontal space and derive Latin advances from each actual
font and weight. A successful short-title screenshot is not a wrapping test.
The mobile catalogue's grid then stretched the artwork link below its square
image, moving the bottom-anchored action off the cover. Align the link to the
start and check both action axes against the artwork, not only text clearance.

## 2026-10-17: Give each admin card one inset owner

The Appearance description used paragraph margins that lost to the admin-wide
paragraph reset, leaving text against the card edge. Use one padded Basalt body
and a shared grid for the radio, title, status and description. Check computed
insets and text alignment at desktop, tablet and phone widths, rather than
assuming a declared margin wins the cascade.
Miniature headings must scale with their card, not the viewport. Cover download
controls also share the preview's width so centered artwork does not leave its
actions stranded at the far edge of a wider form.

## 2026-10-17: Test SVG font selection with mixed families

Cover shard family names end in numeric tokens, so unquoted SVG font-family
lists were invalid. The rasterizer silently used the first registered Latin
family, widening a Tidal Hours title beyond the preview's safe area. Quote each
family name; do not hide the discrepancy by weakening bounds or shrinking all
titles. Compare isolated and mixed-family renders, then exercise all real theme
layouts. A single-family font-loading test cannot detect this fallback.
Focused npm test arguments must target the web workspace directly: the root
wrapper does not forward flags such as --grep to its nested script.

## 2026-10-17: Verify media formats and source resolution end to end

The first PNG dimensions guard read only IHDR and could admit animated PNGs.
Walk bounded chunks and reject animation markers before decoding. Local seeded
episodes also retain three production-CDN image URLs while local media uses
`/media`; treating every cover as a local R2 key broke real downloads. Resolve
only those exact local seed URLs to existing bundled images. Do not repair a
source mismatch by allowing arbitrary remote image fetches.
Isolated build fixtures must also copy referenced public category IDs: existing
local data can contain owner-renamed categories absent from fresh migrations.

## 2026-10-17: Measure the renderer's worst-case memory before setting limits

Small-image success did not justify an 8MP export contract: a high-entropy JPEG
reached 132.375 MiB of WASM memory alone. Keep selected static glyph shards rather
than full CJK fonts, enforce 4 MiB and 4MP before decoding, and admit one render
per isolate. Exercise real PNG/JPEG/WebP in workerd with actual theme layouts.
WASM high-water measurements are not total isolate memory or production CPU
certification; preserve that distinction in the operational contract.

## 2026-10-17: Isolate provider requests in component tests

An upstream JSON-LD shell test mounted the real SEO provider without stubbing
fetch. Its revalidation request escaped Happy DOM and logged a socket error on
unmount even though the assertions passed. Keep the real component lifecycle,
return a valid API payload from an explicit fetch stub, and assert the requested
endpoint. Passing assertions do not make unintended test network traffic safe.

## 2026-10-17: Check the entire cover metadata row

The cover bounds checks passed while Interval's episode number remained above
its two fixed footer labels. Owner review caught the visual mismatch. Compare
shared row baselines, not only each label's bounds, and retain space between the
title and footer. Keep these adjustments in the shared frame export so browser
previews and downloaded PNGs cannot acquire different layouts.

## 2026-10-17: Configure schema startup before enforcing script CSP

Zod's caught `Function()` capability probe still emitted a CSP violation. Set
jitless mode before loading modules that construct schemas, rather than allowing
unsafe-eval or relying only on page-error listeners. Deferring the React bootstrap
also moved hero/frame/player CSS into a JavaScript-loaded chunk. Keep those styles
in the static entry and test the actual production bundle with JavaScript disabled
and a `securitypolicyviolation` listener.

## 2026-10-17: Match thumbnail limits and pixels to the delivery contract

Reusing the composed-PNG renderer's 4 MiB/4MP guards made valid published originals
unavailable through the new thumbnail path. Native Images has a different resource
boundary: stream R2 into it, respect its own input limit, and preserve the trusted
original if transformation cannot complete. Source-width-only resizing also left
landscape images undersampled under center-cover rendering. Include the theme in
the derivative identity and crop to the same bleed-adjusted artwork geometry used
by the browser. Test actual large PNG/JPEG inputs and every nonsquare theme window;
keep original bytes and composed exports unchanged.

The first large-image assertion used generic deep equality on multi-megabyte
buffers. Its synchronous comparison blocked the event loop long enough to expire
a Miniflare connection, making the following fixture fail. Use native
`Buffer.equals` for byte equality; do not hide this with retries or shared fixtures.

## 2026-10-17: Clone fetched headers before applying gateway policy

The new local HTML no-store branch wrote directly into an asset response's
immutable headers, breaking the login and admin shells despite unit success on
mutable fixtures. Apply policy to the existing copied headers and add an explicit
immutable-response regression. Run real local login alongside built public-page
checks; public rendering alone cannot establish studio availability.

## 2026-10-17: Distinguish native cache contracts from local evidence

The pinned cf plugin could not build an explicit `exports.default` configuration.
Use the supported global-disabled/named-enabled configuration with a typed Worker
entry import. The local runtime also did not emulate native Workers Cache or
provide its purge context. Report absent status as UNKNOWN, not MISS, and keep
mock invocation tests separate from edge HIT/purge evidence. Never manufacture a
production editorial mutation merely to obtain cache acceptance evidence.

## 2026-10-18: Consume Miniflare responses before unrelated asynchronous work

A merged raster test retained the blank-render response while Sharp decoded a
different image. A later full gate exposed an unusable response body even though
the first gate passed. The pinned Miniflare immediate-consumption assertion
reproduced the lifecycle violation deterministically. Drain each response into
owned bytes before awaiting image analysis, and enable that assertion for the
workerd fixture. Preserve rendering, geometry, memory and coverage checks; a
retry or longer timeout is not a response-lifetime fix.

## 2026-10-18: Measure the largest public artwork in a cold Worker

A 3000-square JPEG composition passed Node output checks but consumed 214 MiB
of WASM linear memory in cold workerd, above the entire Workers budget. Even a
full-size transparent overlay exceeded that budget. A native draw alternative
then passed dimension checks but lost the original locally: the pinned Miniflare
Images implementation ignores draw layers. Real all-theme pixel comparisons
caught this. Crop the original natively, cap the complete shared composition at
1600 and explicitly upscale larger JPEG outputs. Document the effective-detail
cap, retain cold-workerd memory tests, and distinguish linear-memory measurements
from total-isolate certification. Output dimensions alone do not verify pixels.

A raster test initially called Sharp stats after extract without materializing
the crop; stats inspected the original image. Encode the crop to an owned buffer
before measuring pixels. Native Images also defaults to scale-down: explicitly
select squeeze for overlay upscaling, and verify actual maximum-size JPEG bytes.

The native intermediate JPEG also flattened valid transparent originals to black,
instead of preserving the shared composition's paper behind them. Keep the
bounded crop as alpha-preserving WebP until final JPEG composition, test
translucent original pixel parity, and remeasure that exact intermediate format.
Large PNG responses stalled the pinned local Images proxy during the first
attempt; the existing supported WebP path retains alpha without that failure.

The new shared raster lock also exposed an existing catch-all in authenticated
PNG export: it relabeled contention as a 422 decode failure. Preserve typed
errors and return retryable 503 responses at both public and authenticated entry
points; test guard release after cross-format contention.

## 2026-10-18 — Verify crop pixels, not only binding types

The Images binding exposes coordinate gravity, but the pinned Miniflare runtime
only implements named edge positions and silently centers coordinate requests.
Gradient pixel tests caught the incorrect local share crop before acceptance.
Keep the original stream bounded through native Images, then apply the shared
focal-point geometry to its bounded intermediate in SVG. Verify square, portrait,
landscape and edge-clamped pixels in the actual runtime instead of assuming
generated types prove emulator behavior. No environment-specific fallback is needed.

Changing the SVG helper's artwork argument also required updating the embedded
workerd test source, which static typechecking cannot inspect. The enabled commit
hook caught that stale call; update all callers, including generated test strings,
and measure the new bounded intermediate in the deployed-like memory test.

The initial social-preview browser suite also pinned its temporary validation
port. That passed the targeted run but rejected the repository's default Caddy
URL and the final preview port. Guard local hostnames instead, while honoring
Playwright's configured base URL and keeping the no-content-write tripwire.

The max review found two recovery gaps: a transient share-image 503 stayed locked
to its stable URL, and episode previews could substitute a category ID after a
failed lookup. Offer a same-URL image retry without navigating or saving, and
resolve category metadata inside the shared preview with loading/error/retry
states. Test failure followed by recovery, not just the successful initial render.
The browser recovery test additionally caught the failed selector's missing form
entry clearing the preview category during an unrelated title edit. Preserve the
current category when its input is temporarily absent; absence is not an edit.

Herdr's split ratio describes the leading pane, not the new worker pane. Verify
the returned layout rather than inferring geometry: the controller must use
0.33 on the left, with workers on the right. The initial 0.67 split was corrected.
