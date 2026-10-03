import type { AgentMessage } from '@his-fm/contracts';
import { describe, expect, it } from 'vitest';
import { startsSpeakerGroup, taskStatusLabel } from './presentation';

describe('chat presentation', () => {
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
