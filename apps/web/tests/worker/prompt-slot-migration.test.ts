import { initialPromptSlotTitles, promptKeys, promptSlotInputsSchema } from '@his-fm/contracts';
import { describe, expect, it } from 'vitest';
import { buildPromptSlotMigration } from '../../worker/prompt-slot-migration';

function bodies(content: string, categoryId = 'learning') {
  const result = buildPromptSlotMigration({ content, categoryId });
  return { ...result, bodies: Object.fromEntries(result.slots.map((slot) => [slot.id, slot.body])) };
}

describe('buildPromptSlotMigration', () => {
  it('always creates the eight ordered, enabled append slots, including for empty input', () => {
    const result = buildPromptSlotMigration({ content: '' });
    expect(result).toEqual({
      slots: Object.entries(initialPromptSlotTitles).map(([id, title], order) => ({
        id,
        title,
        body: '',
        order,
        enabled: true,
        mode: 'append',
      })),
      unmappedHeadings: [],
    });
    expect(bodies('').slots).toEqual(result.slots);
    expect(promptSlotInputsSchema.parse(result.slots)).toEqual(result.slots);
  });

  it('splits a learning v11-like document without trimming any mapped Markdown', () => {
    const preamble = '# Daily learning\r\n\r\n  Keep these opening bytes.  \r\n\r\n';
    const positioning = '## 一、栏目定位\r\n\r\nA quiet coffee break.  \r\n\r\n';
    const editor = '## 2. 编辑（Editor）\r\n\r\nWrite carefully.  \r\n### Structure\r\n\r\n- detail\r\n\r\n';
    const collector = '## ③ 采集者（Collector）\r\n\r\nKeep citations.\r\n\r\n';
    const time = '## ②类时间口径\r\n\r\nKeep the original date.\r\n\r\n';
    const quantity = '## 素材量与甄别分工\r\n\r\nCompare all source material.\r\n\r\n';
    const voice = '## 4) 声音（Voice）\r\n\r\nSpeak naturally.\r\n\r\n';
    const cover = '## （5）封面设计师（Cover）\r\n\r\nNo text.\r\n\r\n';
    const producer = '## 六、制作人（Producer）\r\n\r\nCheck delivery.\r\n\r\n';
    const brand = '## 7｜品牌（Brand）\r\n\r\nKeep the identity.\r\n';
    const result = bodies(
      preamble + positioning + editor + collector + time + quantity + voice + cover + producer + brand,
    );
    expect(result.bodies).toEqual({
      positioning: preamble + positioning,
      editor,
      collector: collector + time + quantity,
      voice,
      cover,
      producer,
      brand,
      skills: '',
    });
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('recognizes manager-notes role headings and preserves repeated chunks in source order', () => {
    const chunks = [
      '## 定位\n\nNotes for adults.\n\n',
      '## 编辑\n\nReflect on real experience.\n\n',
      '## 素材采集\n\nKeep useful sources.\n\n',
      '## 旁白\n\nCalm voice.\n\n',
      '## 封面\n\nOriginal art.\n\n',
      '## 制作统筹\n\nDeliver only approved work.\n\n',
      '## 品牌规范\n\nConsistent visual identity.\n\n',
      '## 编辑（审稿）\n\nRetain limitations.\n',
    ];
    const result = bodies(chunks.join(''), 'manager-notes');
    expect(result.bodies.editor).toBe(chunks[1] + chunks[7]);
    expect(result.bodies.collector).toBe(chunks[2]);
    expect(result.bodies.voice).toBe(chunks[3]);
    expect(result.bodies.cover).toBe(chunks[4]);
    expect(result.bodies.producer).toBe(chunks[5]);
    expect(result.bodies.brand).toBe(chunks[6]);
    expect(result.bodies.positioning).toBe(chunks[0]);
    expect(result.unmappedHeadings).toEqual([]);
  });

  const learningHeadings = [
    ['收集信息', 'collector'],
    ['②类（社区新鲜事 / 极客新闻）时间口径', 'collector'],
    ['素材量与甄别分工', 'collector'],
    ['声音生成', 'voice'],
    ['通用 skill', 'skills'],
    ['栏目：慢慢学会 · 每日手冲', 'positioning'],
    ['栏目定位', 'positioning'],
  ];
  const managerHeadings = [
    ['声音生成', 'voice'],
    ['通用 skill', 'skills'],
    ['栏目定位', 'positioning'],
  ];

  it.each([
    ...learningHeadings.map(([heading, role]) => ['learning', heading, role]),
    ...managerHeadings.map(([heading, role]) => ['manager-notes', heading, role]),
  ])('maps the complete %s heading %s to %s without rewriting source bytes', (categoryId, heading, role) => {
    for (const variant of [heading, heading.replace(/ /g, ''), heading.replace(/ /g, '\t  \u3000')]) {
      const body = '\r\n  web-perf  \r\nowner/repo.skill_2\r\n';
      const content = `## \t${variant}\u3000 ###\r\n${body}`;
      const result = bodies(content, categoryId);
      expect(result.bodies[role]).toBe(role === 'skills' ? 'web-perf\nowner/repo.skill_2' : content);
      expect(result.bodies.positioning).toBe(['positioning', 'skills'].includes(role) ? content : '');
      expect(result.unmappedHeadings).toEqual([]);
      expect(promptSlotInputsSchema.safeParse(result.slots).success).toBe(true);
    }
  });

  it.each([
    ['learning', learningHeadings],
    ['manager-notes', managerHeadings],
  ] as const)('fully maps the known %s heading fixture', (categoryId, headings) => {
    const preamble = '# Original policy\n\n';
    const expected = Object.fromEntries(Object.keys(initialPromptSlotTitles).map((id) => [id, '']));
    expected.positioning = preamble;
    const chunks = headings.map(([heading, role], index) => {
      const body = `\nskill-${index}\n\n`;
      const chunk = `## ${heading}\n${body}`;
      expected[role] += role === 'skills' ? `skill-${index}` : chunk;
      if (role === 'skills') expected.positioning += chunk;
      return chunk;
    });
    const result = bodies(preamble + chunks.join(''), categoryId);
    expect(result.bodies).toEqual(expected);
    expect(result.unmappedHeadings).toEqual([]);
  });

  it.each(learningHeadings)('does not match partial aliases containing %s', (heading) => {
    for (const variant of [`说明：${heading}`, `${heading}补充`]) {
      const content = `## ${variant}\nweb-perf\n`;
      const result = bodies(content);
      expect(result.bodies.positioning).toBe(content);
      expect(result.unmappedHeadings).toEqual([variant]);
    }
  });

  it.each(['manager-notes', 'other', '__proto__', 'constructor'])(
    'does not apply learning-only aliases to %s',
    (categoryId) => {
      for (const heading of [
        '收集信息',
        '②类（社区新鲜事 / 极客新闻）时间口径',
        '栏目：慢慢学会 · 每日手冲',
      ]) {
        const content = `## ${heading}\nOriginal text.\n`;
        const result = bodies(content, categoryId);
        expect(result.bodies.positioning).toBe(content);
        expect(result.unmappedHeadings).toEqual([heading]);
      }
    },
  );

  it.each(['learning', 'manager-notes'])(
    'extracts skill names from prose under the %s alias',
    (categoryId) => {
      const content =
        '## 通用 skill\n请使用 **hisfm-bumpers**、`owner/repo.skill_2`，再调用imagegen。\n- hisfm-bumpers\n';
      const result = bodies(content, categoryId);
      expect(result.bodies.skills).toBe('hisfm-bumpers\nowner/repo.skill_2\nimagegen');
      expect(result.bodies.positioning).toBe(content);
      expect(result.unmappedHeadings).toEqual([]);
      expect(promptSlotInputsSchema.safeParse(result.slots).success).toBe(true);
    },
  );

  it.each([
    ['learning', '通用 skill'],
    ['manager-notes', '通用 skill'],
    ['other', 'skills'],
    ['other', '技能'],
    ['other', '技能名称'],
    ['other', '技能清单'],
  ])('keeps %s heading %s mapped even without skill-name tokens', (categoryId, heading) => {
    for (const body of ['', '\r\n', '请遵守栏目规范。\n']) {
      const content = `## ${heading}\n${body}`;
      const result = bodies(content, categoryId);
      expect(result.bodies.skills).toBe('');
      expect(result.bodies.positioning).toBe(content);
      expect(result.unmappedHeadings).toEqual([]);
    }
  });

  it('does not extract skills from a category alias outside its categories', () => {
    const content = '## 通用 skill\n请使用 hisfm-bumpers。\n';
    const result = bodies(content, 'other');
    expect(result.bodies.skills).toBe('');
    expect(result.bodies.positioning).toBe(content);
    expect(result.unmappedHeadings).toEqual(['通用 skill']);
  });

  it.each(Object.keys(initialPromptSlotTitles).filter((id) => id !== 'skills'))(
    'recognizes the exact English initial ID %s with optional closing hashes',
    (id) => {
      const content = `   ## ${id.toUpperCase()} ###\n\n  unchanged body  \n`;
      expect(bodies(content).bodies[id]).toBe(content);
      expect(bodies(content).unmappedHeadings).toEqual([]);
    },
  );

  it('accepts emphasized exact role labels without rewriting their original Markdown', () => {
    const editor = '## **编辑（Editor）**\n\n  保留事实、全角标点与空白。  \n\n';
    const collector = '## __collector__\n\n核对来源。\n';
    const result = bodies(editor + collector);
    expect(result.bodies.editor).toBe(editor);
    expect(result.bodies.collector).toBe(collector);
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('keeps preambles, plain Markdown and unknown sections in positioning and reports heading text', () => {
    const preamble = '\n# Column policy\n\nOpen notes.\n';
    const first = '## Unknown heading ###\n\nKeep this too.\n\n';
    const editor = '## editor\n\nKnown.\n\n';
    const second = '## Archive policy\n\nNo silent loss.  \n\n';
    const result = bodies(preamble + first + editor + second);
    expect(result.bodies.positioning).toBe(preamble + first + second);
    expect(result.bodies.editor).toBe(editor);
    expect(result.unmappedHeadings).toEqual(['Unknown heading', 'Archive policy']);
    expect(bodies(preamble).bodies.positioning).toBe(preamble);
  });

  it.each([
    '编辑与采集',
    '关于编辑的说明',
    '不是编辑',
    '声音与人的距离',
    '品牌与配图',
    '如何联系制作人',
    'editorial',
    'editor guidelines',
    'cover letter',
    'voiceComparison',
    'positioning matters',
    'Future section（editor）',
    'editor（first）（second）',
  ])('does not guess a role from incidental mentions in %s', (heading) => {
    const content = `## ${heading}\n\nOriginal text.\n`;
    const result = bodies(content);
    expect(result.bodies.positioning).toBe(content);
    expect(result.unmappedHeadings).toEqual([heading]);
  });

  it('only applies learning-specific standalone collector sections to learning', () => {
    const content = '## ②类时间口径\n\nTime.\n\n## 素材量与甄别分工\n\nMaterial.\n';
    expect(bodies(content).bodies.collector).toBe(content);
    const result = bodies(content, 'manager-notes');
    expect(result.bodies.collector).toBe('');
    expect(result.bodies.positioning).toBe(content);
    expect(result.unmappedHeadings).toEqual(['②类时间口径', '素材量与甄别分工']);
  });

  it('ignores headings in backtick and tilde fences and retains them with their surrounding chunk', () => {
    const preamble = '````md\n## editor\n```\n## voice\n~~~~\n## producer\n````\n\n';
    const editor = '## editor\n\n~~~ markdown\n## cover\n~~~~\n\n  ```\n## collector\n  ```  \n';
    const voice = '## voice\n\nFinal.\n';
    const result = bodies(preamble + editor + voice);
    expect(result.bodies.positioning).toBe(preamble);
    expect(result.bodies.editor).toBe(editor);
    expect(result.bodies.voice).toBe(voice);
    expect(result.bodies.cover).toBe('');
    expect(result.bodies.collector).toBe('');
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('does not close fences with shorter markers, other markers or trailing text', () => {
    const content = '## editor\n````\n```\n## collector\n~~~~\n## voice\n```` invalid\n## cover\n';
    const result = bodies(content);
    expect(result.bodies.editor).toBe(content);
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('does not treat invalid backtick info strings or four-space-indented fences as open fences', () => {
    const preamble = '```bad`info\n    ```\n';
    const editor = '## editor\nKeep this.\n';
    const result = bodies(preamble + editor);
    expect(result.bodies.positioning).toBe(preamble);
    expect(result.bodies.editor).toBe(editor);
  });

  it('splits only actual level-two headings, not other heading depths, quotations or inline text', () => {
    const content =
      '# editor\n### collector\n#### voice\n> ## cover\n    ## producer\n\\## brand\n##editor\ntext ## cover\n';
    const result = bodies(content);
    expect(result.bodies.positioning).toBe(content);
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('handles empty headings, final headings without newlines and carriage-return-only source bytes', () => {
    const result = bodies('##\r\rBlank.\r## editor\rFirst.\r## voice');
    expect(result.bodies.positioning).toBe('##\r\rBlank.\r');
    expect(result.bodies.editor).toBe('## editor\rFirst.\r');
    expect(result.bodies.voice).toBe('## voice');
    expect(result.unmappedHeadings).toEqual(['']);
  });

  it('preserves the entire original skills section in positioning and copies names only into skills', () => {
    const preamble = '# Skills policy\r\n';
    const section =
      '## 技能名称（Skills）\r\n\r\nweb-perf\r\n  system0-design-basalt  \r\nowner/repo.skill_2\r\n\r\n';
    const editor = '## editor\r\nKeep facts.\r\n';
    const result = bodies(preamble + section + editor);
    expect(result.bodies.positioning).toBe(preamble + section);
    expect(result.bodies.skills).toBe('web-perf\nsystem0-design-basalt\nowner/repo.skill_2');
    expect(result.bodies.editor).toBe(editor);
    expect(result.unmappedHeadings).toEqual([]);
    expect(promptSlotInputsSchema.safeParse(result.slots).success).toBe(true);
  });

  it.each([
    ['Use web-perf to inspect the site.', 'web-perf\nUse\nto\ninspect\nthe\nsite.'],
    ['- web-perf', 'web-perf'],
    ['请运行技能', 'web-perf'],
    ['```\nweb-perf\n```', 'web-perf'],
    ['name: instructions', 'web-perf\nname\ninstructions'],
  ])('extracts pattern-matching tokens while preserving skills prose: %s', (prose, names) => {
    const content = `## skills\n\nweb-perf\n${prose}\n`;
    const result = bodies(content);
    expect(result.bodies.skills).toBe(names);
    expect(result.bodies.positioning).toBe(content);
    expect(result.unmappedHeadings).toEqual([]);
    expect(promptSlotInputsSchema.safeParse(result.slots).success).toBe(true);
  });

  it('keeps repeated skills originals while deduplicating names in source order', () => {
    const content = '## skills\nweb-perf\n\n## 技能\n\nimagegen\nweb-perf\n\n## skills';
    const result = bodies(content);
    expect(result.bodies.skills).toBe('web-perf\nimagegen');
    expect(result.bodies.positioning).toBe(content);
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('combines names from plain and prose-containing skills sections', () => {
    const valid = '## skills\n\nweb-perf\n\n';
    const prose = '## 技能清单\n\n请使用 imagegen 生成封面，再用 web-perf 检查。\n';
    const result = bodies(valid + prose);
    expect(result.bodies.skills).toBe('web-perf\nimagegen');
    expect(result.bodies.positioning).toBe(valid + prose);
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('preserves a final valid skills body without inventing a trailing newline', () => {
    const content = '## skills\nweb-perf';
    const result = bodies(content);
    expect(result.bodies.positioning).toBe(content);
    expect(result.bodies.skills).toBe('web-perf');
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('keeps channel content byte-for-byte in positioning without applying category heading rules', () => {
    const content = '\n# Channel\r\n\r\n## editor\r\n\r\nGlobal content.  \r\n## Unknown';
    const result = buildPromptSlotMigration({ content });
    expect(result.slots.find((slot) => slot.id === 'positioning')?.body).toBe(content);
    expect(result.slots.find((slot) => slot.id === 'editor')?.body).toBe('');
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('migrates every legacy prompt under a labeled heading and preserves every body byte', () => {
    const prompts = Object.fromEntries(promptKeys.map((key) => [key, ` \r\n${key} original body  \r\n\r\n`]));
    const result = buildPromptSlotMigration({ content: '\nChannel original.\n', prompts });
    const byId = Object.fromEntries(result.slots.map((slot) => [slot.id, slot.body]));
    const expected: Record<string, string[]> = {
      producer: [
        'coordinator',
        'executor',
        'capabilities',
        'network',
        'decisionPlan',
        'decisionThinking',
        'compaction',
      ],
      editor: ['reviewer', 'script', 'description'],
      collector: ['boundary', 'brief'],
      voice: ['speech', 'voiceComparison', 'narration'],
      cover: ['cover'],
      positioning: ['editorial'],
    };
    for (const [role, keys] of Object.entries(expected)) {
      const legacy = keys.map((key) => `## Legacy prompt: ${key}\n\n${prompts[key]}`).join('\n\n');
      expect(byId[role]).toBe(role === 'positioning' ? `\nChannel original.\n\n\n${legacy}` : legacy);
    }
    expect(byId.brand).toBe('');
    expect(byId.skills).toBe('');
    expect(result.unmappedHeadings).toEqual([]);
  });

  it('conservatively retains unrecognized and empty legacy prompt bodies in producer', () => {
    const result = buildPromptSlotMigration({
      content: '',
      prompts: { custom: ' Original unknown body.\n', empty: '' },
    });
    expect(result.slots.find((slot) => slot.id === 'producer')?.body).toBe(
      '## Legacy prompt: custom\n\n Original unknown body.\n\n\n## Legacy prompt: empty\n\n',
    );
  });

  it('treats prototype-shaped legacy keys as ordinary unknown names without touching prototypes', () => {
    const prompts = JSON.parse(
      '{"__proto__":"Keep prototype text.","constructor":"Keep constructor text.","toString":"Keep method text."}',
    );
    const result = buildPromptSlotMigration({ content: '', prompts });
    expect(result.slots.find((slot) => slot.id === 'producer')?.body).toBe(
      '## Legacy prompt: __proto__\n\nKeep prototype text.\n\n## Legacy prompt: constructor\n\nKeep constructor text.\n\n## Legacy prompt: toString\n\nKeep method text.',
    );
    expect(Object.hasOwn(Object.prototype, 'body')).toBe(false);
  });
});
