import { describe, expect, it } from 'vitest';
import { cleanText, formatReading, formatWechat, formatXiaoyuzhou } from '../src/shared/publication-format';

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
  sources: [{ id: 'source-1', type: 'url' as const, title: '材料', content: 'https://example.com/?a=1&b=2' }],
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
        { id: 'source-2', type: 'text', title: '', content: '正文' },
        { id: 'source-3', type: 'url', title: '', content: 'https://new.example' },
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
        sources: [{ id: 'source-4', type: 'url', title: '', content: 'invalid' }],
      }).html,
    ).not.toContain('<img');
    expect(cleanText('')).toBe('');
  });
});

describe('long-form review rendering', () => {
  it('renders headings, quotes, lists and tables while keeping links safe', () => {
    const html = formatReading(
      '# 阅读标题\n\n> 具体引用\n\n- 一个细节\n\n| 时间 | 内容 |\n| --- | --- |\n| 今天 | 吃饭 |\n\n[来源](https://example.com/?a=1&b=2)',
    );
    expect(html).toContain('<h1>阅读标题</h1>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<li>一个细节</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('renders markdown links, bare https URLs and angle-bracket autolinks', () => {
    const html = formatReading(
      '[来源](https://example.com/path)\n\n<https://other.example/foo>\n\n详见 https://third.example/bar 结束',
    );
    expect(html).toContain('<a href="https://example.com/path"');
    expect(html).toContain('<a href="https://other.example/foo"');
    expect(html).toContain('<a href="https://third.example/bar"');
    expect(html).not.toContain('&lt;https://');
  });
  it('renders emphasis and ordered lists', () => {
    const html = formatReading('**粗体** 与 *斜体*\n\n1. 第一条\n2. 第二条');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>第一条</li>');
  });
  it('removes active HTML, external images and unsafe URLs from agent content', () => {
    const html = formatReading(
      content.transcript +
        '\n\n[账户](https://user:pass@example.org)\n\n[相对](/admin)\n\n<iframe src="https://evil.example"></iframe>\n\n`<script>code</script>`',
    );
    expect(html).not.toMatch(/<script|<iframe|<img|javascript:|user:pass|href="\/admin/);
    expect(html).not.toContain('evil.example');
    expect(html).toContain('&lt;script&gt;code&lt;/script&gt;');
    expect(html).toContain('危险链接');
    expect(formatReading('')).toBe('');
  });
});
