import type { AgentMessage, ConversationStatus } from '@his-fm/contracts';
import { describe, expect, it } from 'vitest';
import { presentConversations, startsSpeakerGroup, taskStatusLabel } from './presentation';

describe('chat presentation', () => {
  it('presents live roles and task states without inventing progress or exposing model internals', () => {
    const roles = ['主控', '写作', '审校', '写作', '已退出'];
    const statuses = ['working', 'waiting', 'idle', 'failed', 'retired'] as const;
    const conversations: ConversationStatus[] = statuses.map((status, index) => ({
      id: String(index),
      role: roles[index],
      status,
      lifetime: index === 0 ? 'coordinator' : 'task',
      task: `Task ${index}`,
      model: 'private-model',
      thinkingLevel: 'high',
    }));
    const visible = presentConversations(conversations);
    expect(visible.map(({ role, kind, statusLabel, task }) => ({ role, kind, statusLabel, task }))).toEqual([
      { role: '主控', kind: 'coordinator', statusLabel: '工作中', task: 'Task 0' },
      { role: '写作', kind: 'writer', statusLabel: '等待中', task: 'Task 1' },
      { role: '审校', kind: 'reviewer', statusLabel: '空闲', task: 'Task 2' },
      { role: '写作', kind: 'writer', statusLabel: '失败', task: 'Task 3' },
    ]);
    expect(presentConversations([])).toEqual([]);
    expect(JSON.stringify(visible)).not.toContain('private-model');
    expect(conversations).toHaveLength(5);
  });
  it('starts a group only when the speaker changes', () => {
    const messages = ['assistant', 'assistant', 'user', 'assistant'].map((role, index) => ({
      id: String(index),
      role,
      text: 'A message',
      commandId: null,
      createdAt: '2026-10-03T00:00:00Z',
    })) as AgentMessage[];
    expect(messages.map((_, index) => startsSpeakerGroup(messages, index))).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it('labels active task states without implying completion', () => {
    expect(['queued', 'accepted', 'working', 'waiting'].map(taskStatusLabel)).toEqual([
      '准备中',
      '准备中',
      '正在处理',
      '等待中',
    ]);
  });
});
