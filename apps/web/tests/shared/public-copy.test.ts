import { describe, expect, it } from 'vitest';
import { programmeColumnDescription } from '../../src/shared/public-copy';

describe('programmeColumnDescription', () => {
  it('lists configured category names', () => {
    expect(
      programmeColumnDescription([
        { id: 'learning', name: '每日手冲', icon: 'coffee', color: 'amber', seo: {} },
        { id: 'manager-notes', name: '主理人手札', icon: 'briefcase-business', color: 'blue', seo: {} },
        { id: 'look-outside', name: '看看外面', icon: 'compass', color: 'teal', seo: {} },
      ]),
    ).toContain('每日手冲');
    expect(
      programmeColumnDescription([
        { id: 'learning', name: '每日手冲', icon: 'coffee', color: 'amber', seo: {} },
        { id: 'manager-notes', name: '主理人手札', icon: 'briefcase-business', color: 'blue', seo: {} },
        { id: 'look-outside', name: '看看外面', icon: 'compass', color: 'teal', seo: {} },
      ]),
    ).toContain('看看外面');
  });

  it('falls back when no categories are configured', () => {
    expect(programmeColumnDescription([])).toBe('his.fm 是一档给开发者的中文播客。');
  });
});
