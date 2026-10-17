import { scopes } from '@his-fm/contracts';
import { describe, expect, it } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import { agentOpenApi } from '../../worker/agent-contract';

describe('scoped OpenAPI contract', () => {
  it('publishes theme-specific PNG downloads with only the matching record read grant', () => {
    const contract = agentOpenApi('https://example.test');
    for (const resource of ['productions', 'episodes'] as const) {
      const endpoint = contract.paths[`/${resource}/{id}/cover.png`];
      expect(Object.keys(endpoint)).toEqual(['parameters', 'get']);
      expect(endpoint.get['x-required-scopes']).toEqual([`${resource}:read`]);
      expect(endpoint.get.summary).toContain('1600x1600 PNG');
      expect(endpoint.get.parameters).toContainEqual(
        expect.objectContaining({
          name: 'theme',
          in: 'query',
          required: true,
          schema: expect.objectContaining({ enum: [...themeIds] }),
        }),
      );
      expect(endpoint.get.parameters).toContainEqual(
        expect.objectContaining({ name: 'version', required: false }),
      );
      expect(endpoint.get.responses[200].content).toEqual({
        'image/png': { schema: { type: 'string', format: 'binary' } },
      });
      expect(endpoint.get.responses).toHaveProperty('422');
      expect(endpoint.get.responses[200].headers).toHaveProperty('X-Cover-Theme');
      expect(endpoint.get.responses[200].headers).toHaveProperty('X-Resource-Version');
    }
  });

  it('declares grants for each protected operation and keeps business REST independent of station transport', () => {
    const contract = agentOpenApi('https://example.test');
    const operations = Object.entries(contract.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([method]) => ['get', 'head', 'post', 'put', 'patch', 'delete'].includes(method))
        .map(([, operation]) => ({ path, operation: operation as Record<string, unknown> })),
    );
    for (const { operation } of operations) {
      if (Array.isArray(operation.security) && !operation.security.length) continue;
      expect(operation['x-required-scopes']).toBeInstanceOf(Array);
      for (const scope of operation['x-required-scopes'] as string[]) expect(scopes).toContain(scope);
    }
    expect(contract.paths['/productions'].post['x-required-scopes']).toEqual(['productions:write']);
    expect(contract.paths['/productions/{id}/assets/cover'].put['x-required-scopes']).toEqual([
      'productions:write',
      'storage:write',
    ]);
    for (const path of Object.keys(contract.paths))
      expect(path).not.toMatch(/runtime|tasks|ai-settings|production-settings/);
    expect(contract.paths['/productions/{id}/assets/audio'].put['x-required-scopes']).toEqual([
      'productions:write',
      'storage:write',
    ]);
    expect(contract.paths['/productions/{id}/assets/audio/bind'].post['x-required-scopes']).toEqual([
      'productions:write',
      'storage:write',
    ]);
    expect(
      contract.paths['/productions/{id}/assets/audio/bind'].post.requestBody.content['application/json']
        .schema.required,
    ).toEqual(['version', 'key']);
    expect(contract.paths['/agent-tokens/{id}/revoke'].post['x-required-scopes']).toEqual(['tokens:revoke']);
    expect(contract.paths['/agent-tokens/{id}'].delete['x-required-scopes']).toEqual(['tokens:delete']);
    expect(contract.paths['/agent-tokens/{id}'].delete.summary).toContain('409');
    expect(contract.info.description).not.toContain('runtime_required');
  });

  it('derives token input schemas without accepting caller authority', () => {
    const contract = agentOpenApi('https://example.test');
    const token = contract.paths['/agent-tokens'].post.requestBody.content['application/json'].schema;
    expect(token.required).toEqual(['name', 'expiresInDays', 'scopes']);
    expect(token.additionalProperties).toBe(false);
    expect(token.properties?.scopes).toMatchObject({
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { enum: [...scopes] },
    });
    expect(JSON.stringify(contract.paths['/agent-tokens'].get.responses)).not.toContain('token_hash');
  });

  it('describes read projections, authenticated actors and versioned resource lifecycle', () => {
    const contract = agentOpenApi('https://example.test');
    expect(contract.paths['/categories'].get.summary).toContain('prompts:read');
    expect(contract.paths['/productions/{id}'].get.summary).toContain('version');
    expect(contract.paths['/channel'].put.summary).toContain('only the new version');
    expect(contract.components.schemas.ServiceCapabilities.properties).toHaveProperty('scopes');
    expect(contract.components.schemas.ServiceCapabilities.properties).not.toHaveProperty('humanOnly');
    expect(contract.components.schemas.ServiceManifest.properties).toHaveProperty('approvalScopes');
    expect(contract.components.schemas.ServiceManifest.properties).not.toHaveProperty('humanReview');
    for (const [responses, status, resource] of [
      [contract.paths['/productions'].post.responses, 201, 'production'],
      [contract.paths['/episodes/{id}'].patch.responses, 200, 'episode'],
      [contract.paths['/bumpers'].post.responses, 201, 'bumper'],
      [contract.paths['/bumpers/{id}'].put.responses, 200, 'bumper'],
    ] as const) {
      expect(responses).toMatchObject({
        [status]: {
          content: {
            'application/json': {
              schema: {
                anyOf: expect.arrayContaining([
                  expect.objectContaining({
                    properties: {
                      [resource]: expect.objectContaining({
                        required: ['id', 'version'],
                        additionalProperties: false,
                      }),
                    },
                  }),
                ]),
              },
            },
          },
        },
      });
    }
    expect(contract.paths['/bumpers'].post.summary).toContain('Without bumpers:read');
    expect(contract.paths['/bumpers/{id}'].put.summary).toContain('Without bumpers:read');
    expect(contract.components.schemas.ProductionCapabilities.properties?.availableActions).toMatchObject({
      items: { enum: expect.arrayContaining(['approve_brief', 'reopen_assets']) },
    });
    expect(contract.paths['/productions/{id}/publications/{platform}']).toHaveProperty('patch');
    expect(contract.paths['/productions/{id}/publications/{platform}']).toHaveProperty('delete');
    expect(
      contract.paths['/episodes/{id}'].patch.requestBody.content['application/json'].schema.required,
    ).toEqual(['version', 'featured']);
    expect(contract.paths['/storage/cleanup'].post['x-required-scopes']).toEqual(['storage:delete']);
    expect(
      contract.paths['/bumpers/{id}'].put.requestBody.content['application/json'].schema.required,
    ).toEqual(['name', 'position', 'version']);
  });

  it('keeps approval separate from every revise and reopen action', () => {
    const contract = agentOpenApi('https://example.test');
    const grants = contract.paths['/productions/{id}/actions'].post['x-required-scopes-by-action'];
    for (const action of ['approve_brief', 'approve_script', 'approve_final'] as const)
      expect(grants[action]).toEqual(['productions:approve']);
    for (const action of [
      'revise_brief',
      'revise_script',
      'revise_assets',
      'reopen_brief',
      'reopen_script',
      'reopen_assets',
    ] as const)
      expect(grants[action]).toEqual(['productions:reopen']);
  });

  it('allows correcting and withdrawing site publications in the discovered contract', () => {
    const contract = agentOpenApi('https://example.test');
    expect(contract.paths['/productions/{id}/publications/{platform}'].parameters).toContainEqual({
      name: 'platform',
      in: 'path',
      required: true,
      schema: { type: 'string', enum: ['wechat', 'xiaoyuzhou', 'site'] },
    });
  });
});
