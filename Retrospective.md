# Retrospective

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
