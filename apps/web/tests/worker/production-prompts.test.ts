import { describe, expect, it } from 'vitest';
import { productionPrompts } from '../../worker/production-prompts';
import { fixture } from './production-fixture';

describe('productionPrompts', () => {
  it('merges enabled slot guidance, production context and feedback into every role body', () => {
    const production = fixture({
      events: [
        {
          id: 'event-1',
          action: 'revise_brief',
          feedback: '补充时间线',
          actor: { kind: 'human', name: 'owner' },
          at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'event-2',
          action: 'edit',
          feedback: '',
          actor: { kind: 'human', name: 'owner' },
          at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const prompts = productionPrompts(production, [
      {
        id: 'editor',
        title: '编辑',
        body: '先核实，再叙事。',
        order: 0,
        enabled: true,
        mode: 'override',
      },
    ]);
    for (const body of Object.values(prompts)) {
      expect(body).toContain('先核实，再叙事。');
      expect(body).toContain('"intent"');
      expect(body).toContain('补充时间线');
      expect(body).not.toContain('"feedback": null');
    }
  });
});
