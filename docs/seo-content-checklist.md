# Owner content checklist

Technical deployments do not write production editorial settings or supply new
artwork. Complete this checklist before submitting the RSS feed to podcast
directories. An empty podcast cover or owner email remains a launch blocker.

## 1. Confirm identity in Search and Sharing

Open `/admin/seo`, enter the owner-confirmed values, then select Save SEO Settings.
The versioned form preserves unrelated settings; an API client must read the
current version before sending a partial `PUT /api/agent/seo`.

| Studio field | API field | Value |
| --- | --- | --- |
| Author type | `podcastAuthorType` | `Person` |
| Author / producer | `podcastAuthor` | `李征` |
| Author homepage | `podcastAuthorUrl` | `https://lizheng.dev` |
| Podcast owner email | `podcastOwnerEmail` | `hi@his.fm` |
| Podcast cover | `podcastCoverUrl` | The uploaded channel-cover URL from step 2 |
| Default sharing image | `defaultOgImageUrl` | The uploaded social-preview URL from step 3 |

The email is public in RSS. Confirm that the mailbox receives mail before using
it for directory verification. The author homepage must be HTTPS; it appears in
the public footer, About page and PodcastSeries author JSON-LD. The confirmed
blog link is `https://lizheng.blog`. Supply explicit names and URLs before adding
other personal sites; technical deployment does not invent additional links.

Keep the actual podcast language, description and adult-content declaration.
Use an official English Apple taxonomy value such as `Technology` rather than
a local Chinese programme-category name. Do not change factual content merely
to improve a score.

## 2. Supply the podcast channel cover

- Deliver a genuine **3000 x 3000 pixel, square, static JPEG or PNG**.
- Use **RGB / sRGB**, preferably flattened without transparency.
- Keep it recognizable at a small size: this is the continuing show's identity,
  not a different episode illustration on every publication.
- Aim for roughly **1-2 MB** without visible damage. This is an editorial
  optimization target, not a claimed universal directory file-size limit.
- Do not rename a WebP file to `.png`, stretch the existing 768px image and call
  it a high-resolution original, or use the 1600px finished-episode export as
  the requested 3000px channel artwork.

Upload the approved file through `POST /api/agent/storage` with an explicitly
granted `storage:write` token, then copy the returned `url` into `podcastCoverUrl`.
The current `/admin/storage` page scans and previews files; it has no upload
button. For an approved PNG, the API request is:

```sh
curl --fail-with-body https://his.fm/api/agent/storage \
  -H "Authorization: Bearer $HISFM_AGENT_TOKEN" \
  -H 'Content-Type: image/png' \
  --data-binary @podcast-cover.png
```

For a JPEG, use `image/jpeg` and the actual `.jpg` filename. Do not send multipart
form data, choose an object key, or expose the token in shared logs. The server
creates an immutable `uploads/<uuid>` key; the storage limit is 25 MiB. Inspect
the returned public URL in `/admin/storage` and save its SEO reference promptly.

Use that stable HTTPS URL directly, without login,
expiring signatures or an automatic WebP transformation. The response must have
the actual `image/jpeg` or `image/png` MIME type. The settings form validates the
URL, not the file's dimensions or color profile; inspect the actual image.

Channel branding is appropriate for this separate channel asset. Production
cover uploads remain clean originals without text, logos, frames or overlays.
The frontend's responsive WebP derivatives do not replace the RSS image.

## 3. Supply separate Open Graph artwork

- Deliver a **1200 x 630 pixel JPEG or PNG**, with important text and artwork away
  from the outer edge. Aim for **500 KB or less** when visually acceptable.
- Upload it through the same storage API and put its stable public URL in
  `defaultOgImageUrl`.
- If one image should cover *all* pages, including episode details, also put the
  same URL in the global page override's `ogImageUrl` (`overrides.ogImageUrl`).
  The default alone does not override an episode's own cover.
- For an individual production, set `seo.ogImageUrl` in its metadata section.
  Save, complete the applicable final review, and explicitly publish or correct
  its publication to update the public episode snapshot.

The order for episode images is: episode SEO override, global page override,
episode cover, site default. An episode-specific value wins over a global one.
Do not use the square podcast channel cover as the wide social-preview image.

Existing productions without a `seo` field preserve their published snapshot's
SEO. An explicit `seo: {}` clears the episode-specific overrides only when the
reviewed production is published/corrected. Editing SEO does not silently alter
the current public snapshot or revoke an already approved script.

## 4. Correct the confirmed name typo

The earlier inspection found this typo in the first mention of production
`7b81ad45-d60e-4a1f-87fd-e4ed6112079f`, published as
`/episodes/manager-notes/execution-fast-trust-slow`:

```text
Before: 本期改编自的李正博客文章。
After:  本期改编自李征的博客文章。
```

Read the latest public and saved content first; do not reopen an already corrected
production. Otherwise, correct the linked production's mention and follow the
existing reopening/review/publication-correction controls. Check
the current transcript and show notes for other instances before changing them;
do not apply a blind global name replacement. Do not edit the linked episode
snapshot directly in D1 or through standalone episode CRUD.

## 5. Verify after saving and publishing

1. Open `https://his.fm/feed.xml` and confirm a channel `itunes:image`,
   `itunes:owner/itunes:name`, `itunes:owner/itunes:email`, and `itunes:explicit`
   with `true` or `false`.
2. Open the image URL and verify HTTP 200, its actual 3000-square dimensions,
   MIME type and color profile. Confirm the contact mailbox receives mail.
3. Inspect homepage and episode HTML without JavaScript: check the actual
   `og:image` and PodcastSeries author `@type`, `name` and `url`.
4. Read the corrected public mention and RSS item description. Check that audio
   enclosures have positive R2 byte lengths and stored durations.
5. Validate the feed in Apple Podcasts Connect and Spotify for Creators. A code
   release, valid XML or a Lighthouse SEO score is not directory acceptance.

Storage cleanup protects saved site/episode/category SEO URLs and mention URLs,
in addition to existing media references. Save the reference before considering
an uploaded asset disposable. Cleanup cannot discover every use on another site.

## Official references

- https://podcasters.apple.com/support/823-podcast-requirements
- https://podcasters.apple.com/support/5514-show-cover-template
- https://podcasters.apple.com/support/1691-apple-podcasts-categories
- https://providersupport.spotify.com/article/podcast-delivery-specification-1-9
- https://support.spotify.com/us/creators/article/adding-your-email-address-to-your-rss-feed/
