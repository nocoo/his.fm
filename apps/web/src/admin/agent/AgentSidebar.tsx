import { Button } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { useState } from 'react';
import { errorMessage } from '../model';
import { ReadingText } from '../production/ReadingText';
import { useAgent, useAgentState } from './AgentProvider';
import type { AgentClient } from './service';
import './agent.css';

export function AgentSidebar() {
  const client = useAgent();
  return client ? <Sidebar client={client} /> : null;
}

function Sidebar({ client }: { client: AgentClient }) {
  const state = useAgentState(client);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const execute = (action: () => unknown) => {
    try {
      action();
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const running = state.conversations.filter((item) => item.status !== 'retired');
  const pending = state.commands.filter((command) =>
    ['queued', 'accepted', 'working', 'waiting'].includes(command.status),
  );
  return (
    <aside className="agent-sidebar" aria-label="主控对话">
      <header className="agent-header">
        <strong>主控</strong>
        <span className="admin-muted">
          {state.connection === 'ready'
            ? state.online
              ? '在线'
              : '等待本机连接'
            : state.connection === 'blocked'
              ? '需要重新登录'
              : '正在连接'}
        </span>
      </header>
      {running.length > 0 && (
        <details className="agent-roles">
          <summary>运行角色 · {running.length}</summary>
          <ul>
            {running.map((role) => (
              <li key={role.id}>
                <strong>{role.role}</strong>
                <span>
                  {role.status === 'working'
                    ? '工作中'
                    : role.status === 'waiting'
                      ? '等待中'
                      : role.status === 'failed'
                        ? '失败'
                        : '空闲'}
                </span>
                <p>{role.task}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="agent-messages" role="log" aria-label="主控消息" aria-live="polite">
        {!state.messages.length && (
          <p className="admin-muted">在这里和主控讨论这一期，左侧可以继续编辑。保存与审批仍由你确认。</p>
        )}
        {state.messages.map((message) => (
          <article className={`agent-message agent-message-${message.role}`} key={message.id}>
            <strong>{message.role === 'user' ? '你' : '主控'}</strong>
            <ReadingText text={message.text} />
          </article>
        ))}
        {state.proposals.map((proposal) => (
          <article className="agent-proposal" key={proposal.id}>
            <strong>草稿建议</strong>
            <p>{proposal.summary}</p>
            <details>
              <summary>查看建议内容</summary>
              <ReadingText text={proposal.value} />
            </details>
            <div className="studio-actions">
              <Button
                size="sm"
                variant="outline"
                onClick={() => execute(() => client.proposal(proposal, false))}
              >
                拒绝
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  execute(() => {
                    client.command(`请基于当前内容重新修改：${proposal.summary}`);
                    client.proposal(proposal, false);
                  })
                }
              >
                基于当前内容重写
              </Button>
            </div>
          </article>
        ))}
      </div>
      {pending.length > 0 && (
        <div className="agent-tasks">
          {pending.map((command) => (
            <div className="studio-row" key={command.id}>
              <span>{command.detail || '正在处理'}</span>
              <Button size="sm" variant="ghost" onClick={() => execute(() => client.cancel(command.id))}>
                取消任务
              </Button>
            </div>
          ))}
        </div>
      )}
      {(error || state.error) && (
        <p role="alert" className="admin-error agent-error">
          {error || state.error}
        </p>
      )}
      <form
        className="agent-composer"
        onSubmit={(event) => {
          event.preventDefault();
          execute(() => {
            client.command(text);
            setText('');
          });
        }}
      >
        <InputArea
          aria-label="给主控的消息"
          placeholder="和主控讨论…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          maxLength={12000}
        />
        <Button type="submit" size="sm" disabled={!text.trim() || state.connection === 'blocked'}>
          发送
        </Button>
      </form>
    </aside>
  );
}
