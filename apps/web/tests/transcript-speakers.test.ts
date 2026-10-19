import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READING_LABEL_PREFIX,
  formatReading,
  formatWechat,
  sanitizeReadingIdPrefix,
} from '../src/shared/publication-format';
import { parseTranscriptSpeakers, transcriptHasSpeakerBlocks } from '../src/shared/transcript-speakers';

function secureUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReadingBaseline(markdown: string) {
  return markdown
    ? new Marked({
        gfm: true,
        breaks: true,
        renderer: {
          html() {
            return '';
          },
          image() {
            return '';
          },
          link({ href, tokens }) {
            const label = this.parser.parseInline(tokens);
            const url = secureUrl(href);
            return url
              ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
              : label;
          },
        },
      }).parse(markdown, { async: false })
    : '';
}

describe('parseTranscriptSpeakers', () => {
  it('splits the two approved speaker labels into blocks', () => {
    const segments = parseTranscriptSpeakers(
      '# 开场\n\n**主播：** 欢迎来到 his.fm。\n\n**预言家：** 这一季我们会慢慢展开。\n',
    );
    expect(segments).toEqual([
      { kind: 'markdown', text: '# 开场\n\n' },
      { kind: 'speaker', speaker: '主播', text: ' 欢迎来到 his.fm。' },
      { kind: 'speaker', speaker: '预言家', text: ' 这一季我们会慢慢展开。' },
    ]);
    expect(transcriptHasSpeakerBlocks('**主播：** hi')).toBe(true);
    expect(transcriptHasSpeakerBlocks('普通段落')).toBe(false);
  });

  it('keeps unknown speaker labels in markdown and preserves multi-paragraph turns', () => {
    const markdown =
      '**嘉宾：** 不应拆成块。\n\n**主播：** 第一段。\n\n第二段还在主播这里。\n\n**预言家：** 收尾。';
    expect(parseTranscriptSpeakers(markdown)).toEqual([
      { kind: 'markdown', text: '**嘉宾：** 不应拆成块。\n\n' },
      { kind: 'speaker', speaker: '主播', text: ' 第一段。\n\n第二段还在主播这里。' },
      { kind: 'speaker', speaker: '预言家', text: ' 收尾。' },
    ]);
  });

  it('ignores speaker-shaped lines inside fenced or indented code and mid-paragraph soft breaks', () => {
    const markdown = [
      '前文',
      '**主播：** 仍属同一段',
      '',
      '```',
      '**主播：** 代码示例',
      '```',
      '',
      '    **主播：** 缩进代码',
      '',
      '**主播：** 真正的新段落',
    ].join('\n');
    expect(parseTranscriptSpeakers(markdown)).toEqual([
      {
        kind: 'markdown',
        text: '前文\n**主播：** 仍属同一段\n\n```\n**主播：** 代码示例\n```\n\n    **主播：** 缩进代码\n\n',
      },
      { kind: 'speaker', speaker: '主播', text: ' 真正的新段落' },
    ]);
  });

  it('returns markdown when the document only contains reference definitions', () => {
    expect(parseTranscriptSpeakers('[ref]: https://example.com/path')).toEqual([
      { kind: 'markdown', text: '[ref]: https://example.com/path' },
    ]);
  });

  it('keeps multiline speaker paragraphs in the correct turn', () => {
    expect(parseTranscriptSpeakers('**主播：** 问题。\n\n**预言家：** 回答。\n续行。')).toEqual([
      { kind: 'speaker', speaker: '主播', text: ' 问题。' },
      { kind: 'speaker', speaker: '预言家', text: ' 回答。\n续行。' },
    ]);
  });
});

describe('transcript speaker rendering', () => {
  const transcript =
    '**主播：** 先说一句。\n\n接着同一段的第二句。\n\n**预言家：** 回应一句。\n\n**旁白：** 保持 Markdown。';

  it('renders admin reading preview as labeled blocks instead of inline bold labels', () => {
    const html = formatReading(transcript);
    expect(html).toContain('class="studio-transcript-block"');
    expect(html).toContain('data-speaker="主播"');
    expect(html).toContain('studio-transcript-block-label');
    expect(html).toContain('接着同一段的第二句。');
    expect(html).not.toContain('<strong>主播：</strong>');
    expect(html).toContain('<strong>旁白：</strong>');
    expect(html).not.toContain('aria-hidden');
    expect(html).toContain('role="group"');
    const defaultPrefix = sanitizeReadingIdPrefix(DEFAULT_READING_LABEL_PREFIX);
    expect(html).toContain(`aria-labelledby="${defaultPrefix}-0"`);
    expect(html).toContain(`id="${defaultPrefix}-0"`);
  });

  it('uses distinct label prefixes when reading views pass different idPrefix values', () => {
    const first = formatReading('**主播：** 一', { idPrefix: 'reading-view-a' });
    const second = formatReading('**主播：** 二', { idPrefix: 'reading-view-b' });
    expect(first).toContain(`id="${sanitizeReadingIdPrefix('reading-view-a')}-0"`);
    expect(second).toContain(`id="${sanitizeReadingIdPrefix('reading-view-b')}-0"`);
  });

  it('sanitizes idPrefix with injective encoding so distinct React ids never collide', () => {
    const colonId = sanitizeReadingIdPrefix(':r1:');
    const guillemetId = sanitizeReadingIdPrefix('«r1»');
    expect(colonId).not.toBe(guillemetId);
    expect(colonId).toBe('_3a_r1_3a_');
    expect(guillemetId).toBe('_ab_r1_bb_');
    expect(sanitizeReadingIdPrefix('')).toBe(DEFAULT_READING_LABEL_PREFIX);
  });

  it('resolves reference links on glued speaker labels for reading and WeChat', () => {
    const trailingDef = '**主播：**请看[来源][ref]。\n\n[ref]: https://example.com/path';
    const readingTrailing = formatReading(trailingDef);
    expect(readingTrailing).toContain('href="https://example.com/path"');
    expect(readingTrailing).not.toContain('[ref]');
    const { html: wechatTrailing } = formatWechat({
      title: '测试',
      summary: '',
      description: '',
      transcript: trailingDef,
      assets: { cover: null, audio: null },
      sources: [],
    });
    expect(wechatTrailing).toContain('https://example.com/path');
    expect(wechatTrailing).toContain('[1]');

    const laterTurn = '**主播：**请看[来源][ref]。\n\n**预言家：** 收尾。\n\n[ref]: https://example.com/path';
    const readingLater = formatReading(laterTurn);
    expect(readingLater).toContain('href="https://example.com/path"');
    const { html: wechatLater } = formatWechat({
      title: '测试',
      summary: '',
      description: '',
      transcript: laterTurn,
      assets: { cover: null, audio: null },
      sources: [],
    });
    expect(wechatLater).toContain('https://example.com/path');
  });

  it('renders glued speaker labels without duplicating the label in the body', () => {
    const markdown = '**主播：**问题。';
    const reading = formatReading(markdown);
    expect(reading).toContain('data-speaker="主播"');
    expect(reading).not.toContain('<strong>主播：</strong>');
    expect(reading).not.toContain('**主播：**');
    expect(reading).toContain('问题。');
    const { html } = formatWechat({
      title: '测试',
      summary: '',
      description: '',
      transcript: markdown,
      assets: { cover: null, audio: null },
      sources: [],
    });
    expect(html).toContain('data-speaker="主播"');
    expect(html).not.toContain('<strong>主播：</strong>');
    expect(html).toContain('问题。');
  });

  it('renders WeChat HTML with speaker sections for copy and preview', () => {
    const { html } = formatWechat({
      title: '测试',
      summary: '',
      description: '',
      transcript,
      assets: { cover: null, audio: null },
      sources: [],
    });
    expect(html).toContain('data-speaker="主播"');
    expect(html).toContain('data-speaker="预言家"');
    expect(html).toContain('接着同一段的第二句。');
    expect(html).not.toContain('<strong>主播：</strong>');
    expect(html).toContain('<strong>旁白：</strong>');
  });

  it('resolves reference links defined in a later speaker turn for reading and WeChat', () => {
    const linked = '**主播：** 请看[来源][ref]。\n\n**预言家：** 收尾。\n\n[ref]: https://example.com/path';
    const reading = formatReading(linked);
    expect(reading).toContain('href="https://example.com/path"');
    expect(reading).not.toContain('[ref]');
    const { html } = formatWechat({
      title: '测试',
      summary: '',
      description: '',
      transcript: linked,
      assets: { cover: null, audio: null },
      sources: [],
    });
    expect(html).toContain('https://example.com/path');
    expect(html).toContain('[1]');
    expect(html).toContain('参考资料');
  });

  it('resolves reference definitions nested in blockquotes', () => {
    const markdown = '**主播：** 见[来源][nested]\n\n> [nested]: https://blockquote.example/path';
    const html = formatReading(markdown);
    expect(html).toContain('href="https://blockquote.example/path"');
  });

  it('resolves trailing reference definitions without appending raw definition lines to segments', () => {
    const markdown = '**主播：** 见[来源][ref]。\n\n**预言家：** 收尾。\n\n[ref]: https://example.com/path';
    const html = formatReading(markdown);
    expect(html).toContain('href="https://example.com/path"');
    expect(html).not.toMatch(/<p>\[ref\]:/);
  });

  it('matches main reading output when no speaker labels are present', () => {
    for (const markdown of [
      '# 下班之后\n\n一段 **温和** 的话，读一读 [链接](https://example.com)。',
      '```ts\nconst x = 1;\n```\n\n[ref]: https://example.com',
      'See [x][ref2]\n\n> [ref2]: https://nested.example/path',
    ]) {
      expect(formatReading(markdown)).toBe(formatReadingBaseline(markdown));
    }
  });
});
