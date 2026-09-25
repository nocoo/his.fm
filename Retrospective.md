# Retrospective

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
