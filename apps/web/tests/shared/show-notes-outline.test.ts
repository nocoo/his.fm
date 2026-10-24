import { describe, expect, it } from 'vitest';
import { outlineFromShowNotes } from '../../src/shared/show-notes-outline';

const listeningPoints = `agent 的边界该往哪里画。本期沿这条线讲四件事。

本期听点：
- 实验室怎样关住训练中的模型：OpenAI 公开训练环境的隔离做法，据其自述暂停训练 11 天。
- 补丁窗口越缩越短：Drew Silcock 的《这是新的网络常态吗》和 HN 讨论。
- 让 agent 用钥匙却看不见钥匙：1Password for AI Agents、Claude Duet 的凭据隔离设计。
- 把 agent 关进策略能验证的沙箱：NVIDIA OpenShell 和 HN 上关于容器、外泄与遥测的争论。

研究边界：公司和项目自报的数字一律按「据称」处理。`;

describe('episode outline from show notes', () => {
  it('reads the first substantial bullet list and splits each entry at its colon', () => {
    expect(outlineFromShowNotes(listeningPoints)).toEqual([
      {
        title: '实验室怎样关住训练中的模型',
        detail: 'OpenAI 公开训练环境的隔离做法，据其自述暂停训练 11 天。',
      },
      { title: '补丁窗口越缩越短', detail: 'Drew Silcock 的《这是新的网络常态吗》和 HN 讨论。' },
      {
        title: '让 agent 用钥匙却看不见钥匙',
        detail: '1Password for AI Agents、Claude Duet 的凭据隔离设计。',
      },
      {
        title: '把 agent 关进策略能验证的沙箱',
        detail: 'NVIDIA OpenShell 和 HN 上关于容器、外泄与遥测的争论。',
      },
    ]);
  });

  it('accepts a plain discussion list, seed outlines and bold lead-ins', () => {
    expect(
      outlineFromShowNotes(`## 本期讨论

- 为什么代码一小时就写完了，协作中的等待却没有缩短：执行的时钟按小时走，信任的时钟还按月、按年走
- 对自己、对同事、对 AI 的三层信任，分别影响什么：敢不敢做判断和担后果
- 为什么评审不只是在检查代码，也是团队里攒信任的那一段`).map((entry) => entry.title),
    ).toEqual([
      '为什么代码一小时就写完了，协作中的等待却没有缩短',
      '对自己、对同事、对 AI 的三层信任，分别影响什么',
      '为什么评审不只是在检查代码，也是团队里攒信任的那一段',
    ]);
    expect(
      outlineFromShowNotes(`## 收听提纲

- 连续两周限制睡眠：主观困倦和认知表现，为什么没有同步变化？
- 同一个人经历两种收信节奏：压力如何变化，实验又有哪些前提？
- 学一个新工具，也为检查漏项、核对结果留出时间。`),
    ).toEqual([
      { title: '连续两周限制睡眠', detail: '主观困倦和认知表现，为什么没有同步变化？' },
      { title: '同一个人经历两种收信节奏', detail: '压力如何变化，实验又有哪些前提？' },
      { title: '学一个新工具，也为检查漏项、核对结果留出时间。', detail: '' },
    ]);
    expect(
      outlineFromShowNotes(`- **组织架构是放大器**：目标选对放大对的，选错也照样放大。
- **阳谋与同级比较**：手握 AI 的资深管理者转回一线。
- **组织终将走向蒸馏**：个人经验变成公司的养分。`).map((entry) => entry.title),
    ).toEqual(['组织架构是放大器', '阳谋与同级比较', '组织终将走向蒸馏']);
  });

  it('ignores notes without a usable list', () => {
    expect(outlineFromShowNotes('')).toEqual([]);
    expect(outlineFromShowNotes('没有列表的一期，只有两段正文。\n\n第二段。')).toEqual([]);
    expect(outlineFromShowNotes('- 只有两条\n- 不够三条')).toEqual([]);
    expect(outlineFromShowNotes('1. 有序列表不是提纲\n2. 第二条\n3. 第三条')).toEqual([]);
    expect(outlineFromShowNotes('- a：\n- b：\n- c：')).toEqual([]);
  });

  it('caps long lists and long titles instead of truncating them silently', () => {
    const many = Array.from({ length: 20 }, (_, index) => `- 第 ${index + 1} 个话题：细节 ${index + 1}`);
    expect(outlineFromShowNotes(many.join('\n'))).toHaveLength(12);
    const longHead = '很长的标题'.repeat(10);
    expect(outlineFromShowNotes(`- ${longHead}：细节\n- 第二条：细节\n- 第三条：细节`)[0]).toEqual({
      title: longHead,
      detail: '细节',
    });
  });
});
