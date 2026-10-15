import { z } from 'zod';

export const scopes = [
  'productions:read',
  'productions:write',
  'productions:delete',
  'productions:submit',
  'productions:approve',
  'productions:reopen',
  'publications:read',
  'publications:write',
  'publications:delete',
  'episodes:read',
  'episodes:write',
  'episodes:delete',
  'episodes:publish',
  'categories:read',
  'categories:write',
  'categories:delete',
  'prompts:read',
  'prompts:write',
  'appearance:read',
  'appearance:write',
  'settings:read',
  'settings:write',
  'credentials:write',
  'audio:generate',
  'bumpers:read',
  'bumpers:write',
  'bumpers:delete',
  'storage:read',
  'storage:write',
  'storage:delete',
  'tokens:read',
  'tokens:issue',
  'tokens:revoke',
  'tokens:delete',
  'tasks:read',
  'tasks:submit',
  'tasks:cancel',
  'tasks:manage',
  'runtime:connect',
  'runtime:manage',
] as const;
export const scopeSchema = z.enum(scopes);
export type Scope = z.infer<typeof scopeSchema>;
export const grantsSchema = z
  .array(scopeSchema)
  .max(scopes.length)
  .refine((values) => new Set(values).size === values.length, 'Scopes must be unique');
export const principalSchema = z.strictObject({
  kind: z.enum(['human', 'agent']),
  name: z.string().min(1),
  tokenId: z.string().min(1).optional(),
  scopes: grantsSchema.optional(),
  expiresAt: z.number().positive().optional(),
});
export type Principal = z.infer<typeof principalSchema>;
export function hasScope(actor: Principal, scope: Scope): boolean {
  return actor.kind === 'human' || Boolean(actor.scopes?.includes(scope));
}
export const scopePresets = {
  reader: ['productions:read', 'publications:read', 'episodes:read', 'categories:read', 'prompts:read'],
  editor: ['productions:read', 'productions:write', 'productions:submit', 'categories:read', 'prompts:read'],
  coordinator: [
    'productions:read',
    'productions:write',
    'productions:submit',
    'categories:read',
    'prompts:read',
    'audio:generate',
    'runtime:connect',
  ],
  owner: [...scopes],
} satisfies Record<string, Scope[]>;
