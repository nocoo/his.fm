# Episode card API (protocol v1)

Stable, read-only JSON for third-party pages that embed a native playable his.fm episode card (for example Zheng's blog at lizheng.blog). The blog fetches server-side, caches the response, and links visitors to the canonical episode page on his.fm.

## Endpoint

`GET|HEAD /api/card?url={episode page URL}`

`OPTIONS /api/card` answers CORS preflight.

### Request

- `url` (required): absolute episode page URL on the same origin as the request.
- Accepted shape: `{origin}/episodes/{categoryId}/{slug}` with optional trailing slash, query string or hash fragment (query/hash are ignored for lookup).
- In production, `{origin}` is `https://his.fm`. In local development, use the dev site origin (for example `https://hisfm.dev.hexly.ai`) so the Worker can resolve seeded episodes.

Invalid or missing `url` → **400** `{ "error": "节目页面链接无效" }`.

Unknown slug, unpublished/future episode, or category mismatch → **404** `{ "v": 1, "status": "not_found" }`.

### Response headers

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Allow: GET, HEAD, OPTIONS`
- `Content-Type: application/json; charset=utf-8`
- Successful cards: `Cache-Control: public, max-age=300, stale-while-revalidate=3600`
- 404: `Cache-Control: public, max-age=60`

`HEAD` returns the same headers and status as `GET` without a body.

## Protocol v1 body (200)

All keys are snake_case.

| Field | Type | Notes |
| --- | --- | --- |
| `v` | `1` | Protocol version |
| `status` | `"published"` | Only published episodes are returned |
| `page_url` | string | Canonical episode page URL |
| `title` | string | Episode title |
| `description` | string | Episode summary (not full show notes) |
| `show` | `"his.fm"` | Show name |
| `column` | string | Category display name |
| `episode_label` | string | Human label, e.g. `主理人手札 EP.03` |
| `published_at` | string | ISO 8601 timestamp |
| `duration` | integer | Duration in seconds; omitted when zero or unknown |
| `audio` | object | Omitted when there is no playable MP3 enclosure |
| `audio.url` | string | Public MP3 URL (same CDN rules as RSS `enclosure`) |
| `audio.mime` | string | `audio/mpeg` |
| `audio.bytes` | integer | Object size from R2 `HEAD` only; omitted when unavailable |
| `cover` | object | Cover artwork metadata |
| `cover.url` | string | Absolute URL of the square cover original |
| `cover.width` / `cover.height` | integer | `1400` for standard square originals on his.fm storage or bundled episode art; omitted for other HTTPS sources without known dimensions |
| `cover.sizes` | array | `{ url, width }` entries for generated WebP thumbnails when the episode uses on-site storage; omitted for bundled placeholder art |
| `cover.frame_svg` | string | Absolute URL of the current site theme's transparent cover frame SVG |
| `theme` | object | Active public appearance theme |
| `theme.name` | string | Theme display name |
| `theme.accent` / `theme.ink` / `theme.paper` | string | Hex colors from the theme palette |

Audio byte counts and MIME types reuse the RSS feed enclosure resolver (`feed.ts`): R2 `HEAD` on the resolved object key, no audio body reads.

## Example

```http
GET /api/card?url=https%3A%2F%2Fhis.fm%2Fepisodes%2Fmanager-notes%2Fleave-a-note HTTP/1.1
Host: his.fm
```

```json
{
  "v": 1,
  "status": "published",
  "page_url": "https://his.fm/episodes/manager-notes/leave-a-note",
  "title": "给明天留一张纸条",
  "description": "记录今天停下来的位置。",
  "show": "his.fm",
  "column": "主理人手札",
  "episode_label": "主理人手札 EP.03",
  "published_at": "2026-09-01T08:00:00.000Z",
  "duration": 600,
  "audio": {
    "url": "https://f.no.mt/sample.mp3",
    "mime": "audio/mpeg",
    "bytes": 5
  },
  "cover": {
    "url": "https://his.fm/images/episode-01.webp",
    "width": 1400,
    "height": 1400,
    "frame_svg": "https://his.fm/brand/frames/interval.svg"
  },
  "theme": {
    "name": "间隙",
    "accent": "#D6F25B",
    "ink": "#1C211A",
    "paper": "#F5F4EE"
  }
}
```
