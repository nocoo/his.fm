import { describe, expect, it } from 'vitest';
import { cleanText, formatWechat, formatXiaoyuzhou } from '../src/shared/publication-format';

const content = {
  title: '下班之后',
  summary: '一段介绍',
  description: '# 这一期\n\n**把今天停在这里。**\n\n- 00:00 从工作回到生活\n- 03:20 找回自己的节奏',
  transcript:
    '# 下班之后\n\n一段 **温和** 的话，读一读 [原始资料](https://example.com/?a=1&b=2)。\n\n再看[原文](https://example.com/?a=1&b=2)。\n\n<script>alert(1)</script>\n\n![追踪](https://evil.example/pixel)\n\n[危险链接](javascript:alert(1))',
  assets: {
    cover: {
      url: 'https://f.no.mt/covers/test.webp',
      key: 'covers/test.webp',
      mimeType: 'image/webp',
      size: 100,
      scriptVersion: 1,
      createdAt: '',
    },
    audio: null,
  },
  sources: [{ type: 'url' as const, title: '材料', content: 'https://example.com/?a=1&b=2' }],
};
describe('manual platform publication materials', () => {
  it('cleans Xiaoyuzhou text while keeping timestamps, paragraphs and lists', () => {
    const text = formatXiaoyuzhou(content);
    expect(text).toContain('00:00 从工作回到生活');
    expect(text).toContain('• 03:20');
    expect(text).not.toMatch(/<[^>]+>|\*\*|^# /m);
    expect(text).toContain('这一期\n\n把今天停在这里。');
  });
  it('creates inline WeChat formatting, deduplicated references and only the approved cover', () => {
    const { html, text } = formatWechat(content);
    expect(html).toContain('style="');
    expect(html).toContain('https://f.no.mt/covers/test.webp');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('[1]');
    expect(html).not.toContain('[2]');
    expect(text).toContain('参考资料\n[1] https://example.com/?a=1&b=2');
    expect(text).not.toContain('![追踪]');
  });
  it('handles rich markdown without leaving formatting markup in text', () => {
    const markdown =
      '## 小标题\n\n> 引用 *轻轻* ~~过去~~ `code`\n\n1. 第一步\n2. 第二步\n\n---\n\n| 时间 | 事情 |\n| --- | --- |\n| 今天 | 喝水 |\n\n```ts\nconst x = 1;\n```\n\n换行  \n继续\n\nhttps://example.com\n\n[普通](https://example.org)\n\n[相对](/test)\n\n[凭据](https://user:pass@example.org)\n\n[定义]: https://example.org';
    const text = cleanText(markdown);
    expect(text).toContain('时间 / 事情\n今天 / 喝水');
    expect(text).toContain('1. 第一步');
    expect(text).toContain('const x = 1;');
    expect(text).toContain('普通（https://example.org/）');
    expect(text).not.toContain('user:pass');
    const output = formatWechat({
      ...content,
      transcript: markdown,
      sources: [
        { type: 'text', title: '', content: '正文' },
        { type: 'url', title: '', content: 'https://new.example' },
      ],
      assets: { cover: null, audio: null },
    });
    expect(output.html).toContain('<pre style=');
    expect(output.html).toContain('<code>code</code>');
    expect(output.html).toContain('https://new.example/');
  });
  it('omits absent and unsafe covers, links and source content', () => {
    const empty = { ...content, transcript: '', assets: { cover: null, audio: null }, sources: [] };
    expect(formatWechat(empty).html).not.toContain('<img');
    expect(formatWechat(empty).text).toBe('\n\nhis.fm');
    expect(
      formatWechat({
        ...content,
        assets: { ...content.assets, cover: { ...content.assets.cover, url: 'javascript:alert(1)' } },
        sources: [{ type: 'url', title: '', content: 'invalid' }],
      }).html,
    ).not.toContain('<img');
    expect(cleanText('')).toBe('');
  });
});
