import type { Miniflare } from 'miniflare';

export const r2FixtureWorker = `
export default {
  async fetch(request, env) {
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    await env.MEDIA.put(key, request.body);
    return new Response(null, { status: 204 });
  }
};
`;

export async function putR2Fixture(runtime: Miniflare, key: string, bytes: Uint8Array): Promise<void> {
  const response = await runtime.dispatchFetch(`http://fixture.test/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: bytes,
  });
  const message = await response.text();
  if (response.status !== 204) throw new Error(`R2 fixture upload failed (${response.status}): ${message}`);
}
