import { describe, expect, it } from 'vitest';
import { formatReading, formatWechat } from '../src/shared/publication-format';
import { parseTranscriptSpeakers, transcriptHasSpeakerBlocks } from '../src/shared/transcript-speakers';

describe('parseTranscriptSpeakers', () => {
  it('splits the two approved speaker labels into blocks', () => {
    const segments = parseTranscriptSpeakers(
      '# 开场\n\n**主播：** 欢迎来到 his.fm。\n\n**预言家：** 这一季我们会慢慢展开。\n',
    );
    expect(segments).toEqual([
      { kind: 'markdown', text: '# 开场\n' },
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
      { kind: 'markdown', text: '**嘉宾：** 不应拆成块。\n' },
      { kind: 'speaker', speaker: '主播', text: ' 第一段。\n\n第二段还在主播这里。' },
      { kind: 'speaker', speaker: '预言家', text: ' 收尾。' },
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
});
