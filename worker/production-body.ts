import type { z } from 'zod';
import { HttpError } from './http';

export async function readBytes(request: Request, limit: number) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413, '上传内容过大');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求内容不能为空');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new HttpError(413, '上传内容过大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw new HttpError(415, '请使用 JSON 请求');
  const bytes = await readBytes(request, 750000);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, '请求内容不是有效的 JSON');
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? '请检查请求内容');
  return result.data;
}
