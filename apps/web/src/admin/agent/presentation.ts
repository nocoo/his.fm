import type { AgentMessage } from '@his-fm/contracts';

export function startsSpeakerGroup(messages: AgentMessage[], index: number): boolean {
  return index === 0 || messages[index - 1].role !== messages[index].role;
}

export function taskStatusLabel(status: string): string {
  if (status === 'waiting') return '等待中';
  if (status === 'working') return '正在处理';
  return '准备中';
}
