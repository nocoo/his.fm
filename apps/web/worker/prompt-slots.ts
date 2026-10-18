import {
  hasScope,
  mergePromptSlots,
  orderedPromptSlots,
  type PromptSlot,
  type PromptSlotInput,
  type PromptSlotTable,
  promptSlotApplySchema,
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
import { channelDefault, defaultPrompts } from './prompt-defaults';
import { buildPromptSlotMigration } from './prompt-slot-migration';

type LegacyRow = {
  version: number;
  content: string;
  prompts?: string | null;
  prompt_slots: string | null;
  prompt_slots_version: number;
  updated_at: string;
  updated_by: string;
};
const target = (categoryId?: string) => ({
  table: categoryId ? 'categories' : 'channel_profile',
  id: categoryId ?? 1,
});
function asTable(row: LegacyRow): PromptSlotTable {
  return {
    version: row.prompt_slots_version,
    initialized: row.prompt_slots !== null,
    slots: row.prompt_slots === null ? [] : orderedPromptSlots(JSON.parse(row.prompt_slots) as PromptSlot[]),
  };
}
async function readLegacy(db: D1Database, categoryId?: string): Promise<LegacyRow> {
  const { table, id } = target(categoryId);
  const row = await db
    .prepare(
      `SELECT version, ${categoryId ? 'prompt AS content' : 'content, prompts'}, prompt_slots, prompt_slots_version, updated_at, updated_by FROM ${table} WHERE id = ?`,
    )
    .bind(id)
    .first<LegacyRow>();
  if (row) return row;
  if (categoryId) throw new HttpError(404, '栏目不存在');
  return {
    version: 0,
    content: channelDefault.trim(),
    prompts: JSON.stringify(defaultPrompts),
    prompt_slots: null,
    prompt_slots_version: 0,
    updated_at: '',
    updated_by: '',
  };
}
export async function getPromptSlotTable(db: D1Database, categoryId?: string) {
  return asTable(await readLegacy(db, categoryId));
}
export async function promptSlotDryRun(db: D1Database, categoryId?: string) {
  const row = await readLegacy(db, categoryId);
  const current = asTable(row);
  return {
    version: current.version,
    legacyVersion: row.version,
    initialized: current.initialized,
    ...(current.initialized
      ? { slots: current.slots, unmappedHeadings: [] as string[] }
      : buildPromptSlotMigration({
          content: row.content,
          ...(categoryId
            ? { categoryId }
            : {
                prompts: row.prompts ? (JSON.parse(row.prompts) as Record<string, string>) : defaultPrompts,
              }),
        })),
  };
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
async function applyMigration(
  db: D1Database,
  actor: Actor,
  input: { version: number; legacyVersion: number },
  categoryId?: string,
) {
  const row = await readLegacy(db, categoryId);
  if (row.prompt_slots !== null) return asTable(row);
  if (input.version !== row.prompt_slots_version || input.legacyVersion !== row.version)
    throw new HttpError(409, '提示词已更新，请重新预览迁移');
  const report = await promptSlotDryRun(db, categoryId);
  const validated = promptSlotInputsSchema.safeParse(report.slots);
  if (!validated.success) throw new HttpError(409, '迁移结果超出提示词限制，请先检查报告');
  const slots = stampSlots(validated.data, [], actor);
  const { table, id } = target(categoryId);
  const now = new Date().toISOString();
  const backup = JSON.stringify(row);
  const backupStatement = db
    .prepare(
      `INSERT INTO prompt_slot_backups (id,level,resource_id,legacy_version,data,created_at,created_by)
     SELECT ?,?,?,?,?,?,? WHERE ${row.version === 0 ? 'NOT EXISTS (SELECT 1 FROM channel_profile WHERE id=1)' : `EXISTS (SELECT 1 FROM ${table} WHERE id=? AND version=? AND prompt_slots IS NULL)`}`,
    )
    .bind(
      crypto.randomUUID(),
      categoryId ? 'category' : 'channel',
      String(id),
      row.version,
      backup,
      now,
      actor.name,
      ...(row.version === 0 ? [] : [id, row.version]),
    );
  const write =
    row.version === 0
      ? db
          .prepare(
            'INSERT INTO channel_profile (id,version,content,prompts,updated_at,updated_by,prompt_slots,prompt_slots_version) VALUES (1,1,?,?,?,?,?,1) ON CONFLICT DO NOTHING',
          )
          .bind(row.content, row.prompts, now, actor.name, JSON.stringify(slots))
      : db
          .prepare(
            `UPDATE ${table} SET prompt_slots=?, prompt_slots_version=1, version=version+1, updated_at=?, updated_by=? WHERE id=? AND version=? AND prompt_slots IS NULL`,
          )
          .bind(JSON.stringify(slots), now, actor.name, id, row.version);
  const results = await db.batch([backupStatement, write]);
  if (results[1].meta.changes !== 1) throw new HttpError(409, '提示词已更新，请重新预览迁移');
  return { version: 1, initialized: true, slots };
}
function validateInputs(slots: PromptSlotInput[]) {
  const result = promptSlotInputsSchema.safeParse(slots);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? '请检查提示词');
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
  if (!current.initialized) throw new HttpError(409, '请先预览并明确应用旧提示词迁移');
  if (current.version !== version) throw new HttpError(409, '提示词已更新，草稿已保留，请刷新后对照');
  const slots = stampSlots(validateInputs(inputs), current.slots, actor);
  const { table, id } = target(categoryId);
  const result = await db
    .prepare(
      `UPDATE ${table} SET prompt_slots=?, prompt_slots_version=prompt_slots_version+1, version=version+1, updated_at=?, updated_by=? WHERE id=? AND prompt_slots_version=? AND prompt_slots IS NOT NULL`,
    )
    .bind(JSON.stringify(slots), new Date().toISOString(), actor.name, id, version)
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
  if (suffix === '/migration/dry-run' && read) return json(await promptSlotDryRun(env.DB, categoryId));
  if (suffix === '/migration/apply' && request.method === 'POST')
    return json(
      project(
        await applyMigration(env.DB, actor, await readJson(request, promptSlotApplySchema), categoryId),
      ),
    );
  if (suffix.startsWith('/migration/')) throw new HttpError(405, '迁移预览使用 GET，明确应用使用 POST');
  const slotId = suffix ? promptSlotIdSchema.safeParse(suffix.slice(1)) : null;
  if (slotId && !slotId.success) throw new HttpError(404, '提示词槽不存在');
  const current = await getPromptSlotTable(env.DB, categoryId);
  if (read && !suffix) {
    if (!url.searchParams.has('slot')) return json(current);
    if (url.searchParams.getAll('slot').length !== 1) throw new HttpError(400, '请只提供一次 slot 参数');
    const selected = (url.searchParams.get('slot') ?? '').split(',');
    if (selected.some((id) => !promptSlotIdSchema.safeParse(id).success))
      throw new HttpError(400, '请提供有效的提示词槽 ID');
    const channel = categoryId ? await getPromptSlotTable(env.DB) : current;
    if (!channel.initialized || !current.initialized)
      throw new HttpError(409, '请先明确应用频道与栏目提示词迁移');
    const slots = mergePromptSlots(channel.slots, categoryId ? current.slots : []).filter((slot) =>
      selected.includes(slot.id),
    );
    return json({
      ...current,
      slots,
      body: synthesizePromptSlots(slots),
      versions: { channel: channel.version, ...(categoryId ? { category: current.version } : {}) },
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
