import { describe, expect, it } from 'vitest';
import {
  programmeColumnDescription,
  programmeColumnDescriptionForEpisodes,
} from '../../src/shared/public-copy';

describe('programmeColumnDescription', () => {
  const allColumns = [
    { id: 'learning', name: '每日手冲', icon: 'coffee', color: 'amber', seo: {} },
    { id: 'manager-notes', name: '主理人手札', icon: 'briefcase-business', color: 'blue', seo: {} },
    { id: 'look-outside', name: '看看外面', icon: 'compass', color: 'teal', seo: {} },
    { id: 'life', name: '生活留白', icon: 'leaf', color: 'amber', seo: {} },
  ] as const;

  it('lists configured category names', () => {
    expect(programmeColumnDescription([...allColumns].slice(0, 3))).toContain('每日手冲');
    expect(programmeColumnDescription([...allColumns].slice(0, 3))).toContain('看看外面');
  });

  it('lists only columns that currently have indexable episodes', () => {
    const text = programmeColumnDescriptionForEpisodes(
      [...allColumns],
      [{ category: 'learning' }, { category: 'manager-notes' }],
    );
    expect(text).toContain('每日手冲');
    expect(text).toContain('主理人手札');
    expect(text).not.toContain('生活留白');
    expect(text).not.toContain('看看外面');
  });

  it('falls back when no categories are configured', () => {
    expect(programmeColumnDescription([])).toBe('his.fm 是一档给开发者的中文播客。');
  });
});
