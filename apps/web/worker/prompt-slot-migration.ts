import { initialPromptSlotTitles, type PromptSlotInput } from '@his-fm/contracts';

type InitialSlotId = keyof typeof initialPromptSlotTitles;

const roleAliases: Record<InitialSlotId, string[]> = {
  positioning: ['定位', '栏目定位', '频道定位', '节目定位'],
  editor: ['编辑', '总编', '编辑者', '编辑角色', '编辑要求', '编辑提示词'],
  collector: ['采集', '采集者', '采集员', '素材采集', '采集要求', '采集提示词'],
  voice: ['声音', '旁白', '播音', '播讲', '播音员', '配音', '声音设计'],
  cover: ['封面', '配图', '封面设计', '封面设计师'],
  producer: ['制作', '制作人', '监制', '制作统筹'],
  brand: ['品牌', '品牌规范', '品牌风格'],
  skills: ['技能', '技能名称', '技能清单'],
};

const legacyRoles: Record<string, InitialSlotId> = {
  coordinator: 'producer',
  executor: 'producer',
  reviewer: 'editor',
  script: 'editor',
  description: 'editor',
  brief: 'collector',
  boundary: 'collector',
  speech: 'voice',
  voiceComparison: 'voice',
  narration: 'voice',
  cover: 'cover',
  editorial: 'positioning',
};

function roleForHeading(heading: string, categoryId: string): InitialSlotId | undefined {
  const label = heading
    .replace(/^(?:\d+[.)）、:：｜-]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.：:]|[①-⑳])\s*/, '')
    .replace(/^(\*\*|__)(.*?)\1$/, '$2');
  if (categoryId === 'learning' && (/^②\s*类时间口径$/.test(heading) || label === '素材量与甄别分工'))
    return 'collector';
  const role = label
    .replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/, '')
    .trim()
    .toLowerCase();
  for (const [id, aliases] of Object.entries(roleAliases)) {
    if (role === id || aliases.includes(role)) return id as InitialSlotId;
  }
  return undefined;
}

export function buildPromptSlotMigration(input: {
  content: string;
  prompts?: Record<string, string>;
  categoryId?: string;
}): { slots: PromptSlotInput[]; unmappedHeadings: string[] } {
  const slots: PromptSlotInput[] = Object.entries(initialPromptSlotTitles).map(([id, title], order) => ({
    id,
    title,
    body: '',
    order,
    enabled: true,
    mode: 'append',
  }));
  const byId = Object.fromEntries(slots.map((slot) => [slot.id, slot]));
  const unmappedHeadings: string[] = [];
  if (input.categoryId === undefined) {
    byId.positioning.body = input.content;
  } else {
    const headings: { start: number; bodyStart: number; text: string }[] = [];
    let fence: { marker: string; length: number } | undefined;
    for (const line of input.content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
      const text = line[0].replace(/(?:\r\n|\r|\n)$/, '');
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
      if (fence) {
        if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim())
          fence = undefined;
        continue;
      }
      if (marker && (marker[1][0] === '~' || !marker[2].includes('`'))) {
        fence = { marker: marker[1][0], length: marker[1].length };
        continue;
      }
      const heading = /^ {0,3}##(?:[\t ]+(.*)|$)/.exec(text);
      if (heading)
        headings.push({
          start: line.index,
          bodyStart: line.index + line[0].length,
          text: (heading[1] ?? '').replace(/[\t ]+#+[\t ]*$/, '').trim(),
        });
    }
    byId.positioning.body = input.content.slice(0, headings[0]?.start ?? input.content.length);
    for (const [index, heading] of headings.entries()) {
      const end = headings[index + 1]?.start ?? input.content.length;
      const chunk = input.content.slice(heading.start, end);
      const role = roleForHeading(heading.text, input.categoryId);
      if (role === 'skills') {
        const names = input.content.slice(heading.bodyStart, end);
        byId.positioning.body += chunk;
        if (
          names
            .split(/\r\n|\r|\n/)
            .every((name) => !name.trim() || /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name.trim()))
        )
          byId.skills.body += names;
        else unmappedHeadings.push(heading.text);
      } else if (role) {
        byId[role].body += chunk;
      } else {
        byId.positioning.body += chunk;
        unmappedHeadings.push(heading.text);
      }
    }
  }
  for (const [key, body] of Object.entries(input.prompts ?? {})) {
    const slot = byId[Object.hasOwn(legacyRoles, key) ? legacyRoles[key] : 'producer'];
    slot.body += `${slot.body ? '\n\n' : ''}## Legacy prompt: ${key}\n\n${body}`;
  }
  return { slots, unmappedHeadings };
}
