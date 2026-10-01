# Retrospective

## 2026-10-01 - Check emulator types before committing upgrades

The Cloudflare tooling upgrade built successfully and passed runtime tests, but the commit gate rejected five Miniflare fixtures that still supplied the removed `config.type` field. Remove the obsolete discriminator rather than casting around the new schema. For coupled emulator upgrades, run typecheck alongside focused runtime checks before attempting the atomic commit; a successful application build does not validate test fixture types.

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
