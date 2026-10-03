import type { AgentMessage, ConversationStatus } from '@his-fm/contracts';

export function presentConversations(conversations: ConversationStatus[]) {
  const labels = { idle: '空闲', working: '工作中', waiting: '等待中', failed: '失败', retired: '已结束' };
  return conversations
    .filter((conversation) => conversation.status !== 'retired')
    .map((conversation) => ({
      id: conversation.id,
      role: conversation.role,
      status: conversation.status,
      task: conversation.task,
      statusLabel: labels[conversation.status],
      kind:
        conversation.lifetime === 'coordinator'
          ? 'coordinator'
          : conversation.role === '审校'
            ? 'reviewer'
            : 'writer',
    }));
}

export function startsSpeakerGroup(messages: AgentMessage[], index: number): boolean {
  return index === 0 || messages[index - 1].role !== messages[index].role;
}

export function taskStatusLabel(status: string): string {
  if (status === 'waiting') return '等待中';
  if (status === 'working') return '正在处理';
  return '准备中';
}
