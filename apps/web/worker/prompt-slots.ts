import {
  hasScope,
  mergePromptSlots,
  orderedPromptSlots,
  type PromptSlot,
  type PromptSlotInput,
  type PromptSlotTable,
  promptSlotCreateSchema,
  promptSlotIdSchema,
  promptSlotInputsSchema,
  promptSlotPatchSchema,
  promptSlotReplaceSchema,
  synthesizePromptSlots,
} from '@his-fm/contracts';
import type { Actor } from '../src/shared/production';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

type SlotRow = {
  version: number;
  prompt_slots: string | null;
  prompt_slots_version: number;
  updated_at: string;
  updated_by: string;
};
const target = (categoryId?: string) => ({
  table: categoryId ? 'categories' : 'channel_profile',
  id: categoryId ?? 1,
});
function asTable(row: SlotRow): PromptSlotTable {
  return {
    version: row.prompt_slots_version,
    initialized: row.prompt_slots !== null,
    slots: row.prompt_slots === null ? [] : orderedPromptSlots(JSON.parse(row.prompt_slots) as PromptSlot[]),
  };
}
async function readSlotRow(db: D1Database, categoryId?: string): Promise<SlotRow> {
  const { table, id } = target(categoryId);
  const row = await db
    .prepare(
      `SELECT version, prompt_slots, prompt_slots_version, updated_at, updated_by FROM ${table} WHERE id = ?`,
    )
    .bind(id)
    .first<SlotRow>();
  if (row) return row;
  if (categoryId) throw new HttpError(404, '栏目不存在');
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO channel_profile (id, version, updated_at, updated_by, prompt_slots_version) VALUES (1, 1, ?, ?, 0) ON CONFLICT DO NOTHING',
    )
    .bind(now, 'his.fm')
    .run();
  return {
    version: 1,
    prompt_slots: null,
    prompt_slots_version: 0,
    updated_at: now,
    updated_by: 'his.fm',
  };
}
export async function getPromptSlotTable(db: D1Database, categoryId?: string) {
  return asTable(await readSlotRow(db, categoryId));
}
function stampSlots(inputs: PromptSlotInput[], previous: PromptSlot[], actor: Actor): PromptSlot[] {
  const now = new Date().toISOString();
  return orderedPromptSlots(inputs).map((input) => {
    const old = previous.find((slot) => slot.id === input.id);
    const unchanged =
      old && Object.entries(input).every(([key, value]) => old[key as keyof PromptSlot] === value);
    return unchanged
      ? old
      : { ...input, version: (old?.version ?? 0) + 1, updatedAt: now, updatedBy: actor.name };
  });
}
function validateInputs(slots: PromptSlotInput[]) {
  const result = promptSlotInputsSchema.safeParse(slots);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? '提示词槽无效';
    throw new HttpError(400, message);
  }
  return result.data;
}
async function saveSlots(
  db: D1Database,
  actor: Actor,
  current: PromptSlotTable,
  version: number,
  inputs: PromptSlotInput[],
  categoryId?: string,
) {
  if (current.version !== version) throw new HttpError(409, '提示词已更新，草稿已保留，请刷新后对照');
  const slots = stampSlots(validateInputs(inputs), current.slots, actor);
  const { table, id } = target(categoryId);
  const now = new Date().toISOString();
  const serialized = JSON.stringify(slots);
  const result = current.initialized
    ? await db
        .prepare(
          `UPDATE ${table} SET prompt_slots=?, prompt_slots_version=prompt_slots_version+1, version=version+1, updated_at=?, updated_by=? WHERE id=? AND prompt_slots_version=? AND prompt_slots IS NOT NULL`,
        )
        .bind(serialized, now, actor.name, id, version)
        .run()
    : await db
        .prepare(
          `UPDATE ${table} SET prompt_slots=?, prompt_slots_version=1, version=version+1, updated_at=?, updated_by=? WHERE id=? AND prompt_slots_version=? AND prompt_slots IS NULL`,
        )
        .bind(serialized, now, actor.name, id, version)
        .run();
  if (result.meta.changes !== 1) throw new HttpError(409, '提示词已更新，草稿已保留，请刷新后对照');
  return { version: version + 1, initialized: true, slots };
}
export async function routePromptSlots(
  request: Request,
  env: Env,
  actor: Actor,
  categoryId?: string,
  suffix = '',
) {
  const read = request.method === 'GET';
  requireScope(actor, read ? 'prompts:read' : 'prompts:write');
  const url = new URL(request.url);
  const project = (value: PromptSlotTable) =>
    hasScope(actor, 'prompts:read') ? value : { version: value.version };
  if (suffix.startsWith('/migration/')) throw new HttpError(404, '提示词迁移已移除，请直接编辑槽位');
  const slotId = suffix ? promptSlotIdSchema.safeParse(suffix.slice(1)) : null;
  if (slotId && !slotId.success) throw new HttpError(404, '提示词槽不存在');
  const current = await getPromptSlotTable(env.DB, categoryId);
  if (read && !suffix) {
    if (!url.searchParams.has('slot')) return json(current);
    if (url.searchParams.getAll('slot').length !== 1) throw new HttpError(400, '请只提供一次 slot 参数');
    const slotParam = url.searchParams.get('slot');
    if (!slotParam) throw new HttpError(400, '请只提供一次 slot 参数');
    const selected = slotParam.split(',');
    if (selected.some((id) => !promptSlotIdSchema.safeParse(id).success))
      throw new HttpError(400, '请提供有效的提示词槽 ID');
    const channel = categoryId ? await getPromptSlotTable(env.DB) : current;
    const category = categoryId ? current : { version: 0, initialized: true, slots: [] as PromptSlot[] };
    const slots = mergePromptSlots(channel.slots, category.slots).filter((slot) =>
      selected.includes(slot.id),
    );
    return json({
      ...current,
      slots,
      body: synthesizePromptSlots(slots),
      versions: { channel: channel.version, ...(categoryId ? { category: category.version } : {}) },
    });
  }
  const inputs = current.slots.map(({ version: _version, updatedAt: _at, updatedBy: _by, ...slot }) => slot);
  let version: number;
  let next: PromptSlotInput[];
  if (!suffix && request.method === 'PUT') {
    const input = await readJson(request, promptSlotReplaceSchema);
    version = input.version;
    next = input.slots;
  } else if (!suffix && request.method === 'POST') {
    const { version: expected, ...slot } = await readJson(request, promptSlotCreateSchema);
    version = expected;
    if (inputs.some((entry) => entry.id === slot.id)) throw new HttpError(409, '提示词槽 ID 已存在');
    next = [...inputs, slot];
  } else if (slotId?.success && ['PATCH', 'DELETE'].includes(request.method)) {
    const input =
      request.method === 'PATCH'
        ? await readJson(request, promptSlotPatchSchema)
        : { version: Number(url.searchParams.get('version')) };
    version = input.version;
    if (!url.searchParams.has('version') && request.method === 'DELETE')
      throw new HttpError(400, '请提供提示词集合版本');
    if (!Number.isSafeInteger(version) || version < 0) throw new HttpError(400, '请提供提示词集合版本');
    if (version !== current.version) throw new HttpError(409, '提示词已更新，请刷新后对照');
    if (!inputs.some((entry) => entry.id === slotId.data)) throw new HttpError(404, '提示词槽不存在');
    const { version: _expected, ...changes } = input;
    next =
      request.method === 'DELETE'
        ? inputs.filter((entry) => entry.id !== slotId.data)
        : inputs.map((entry) => (entry.id === slotId.data ? { ...entry, ...changes } : entry));
  } else throw new HttpError(405, '不支持这个提示词请求方式');
  return json(
    project(await saveSlots(env.DB, actor, current, version, next, categoryId)),
    request.method === 'POST' ? 201 : 200,
  );
}
