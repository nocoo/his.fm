import { HttpError } from './http';

export function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) return null;
  return { offset: start, length: end - start + 1 };
}

export async function streamMedia(request: Request, bucket: R2Bucket, object: R2Object, headers: Headers) {
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());
  const matches = (value: string, weak: boolean) =>
    value.split(',').some((tag) => {
      const candidate = tag.trim();
      return candidate === '*' || (weak ? candidate.replace(/^W\//, '') : candidate) === object.httpEtag;
    });
  const ifMatch = request.headers.get('If-Match');
  const ifNoneMatch = request.headers.get('If-None-Match');
  const unmodified = request.headers.get('If-Unmodified-Since');
  const modified = request.headers.get('If-Modified-Since');
  const uploaded = Math.floor(object.uploaded.getTime() / 1000) * 1000;
  if ((ifMatch && !matches(ifMatch, false)) || (!ifMatch && unmodified && uploaded > Date.parse(unmodified)))
    return new Response(null, { status: 412, headers });
  if (
    (ifNoneMatch && matches(ifNoneMatch, true)) ||
    (!ifNoneMatch && modified && uploaded <= Date.parse(modified))
  )
    return new Response(null, { status: 304, headers });
  const ifRange = request.headers.get('If-Range');
  const rangeHeader =
    request.method === 'GET' && (!ifRange || ifRange === object.httpEtag || uploaded <= Date.parse(ifRange))
      ? request.headers.get('Range')
      : null;
  const range = rangeHeader ? byteRange(rangeHeader, object.size) : undefined;
  if (range === null) {
    headers.set('Content-Range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Length', String(range?.length ?? object.size));
  if (range)
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });
  const content = await bucket.get(object.key, { range, onlyIf: { etagMatches: object.etag } });
  if (!content || !('body' in content)) throw new HttpError(409, '资源已变化，请重新打开');
  return new Response(content.body, { status: range ? 206 : 200, headers });
}
