import { Button } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { ArrowDown, ArrowUp, Check, Copy, Sparkles } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '../model';
import { ReadingText } from '../production/ReadingText';
import { useAgent, useAgentState } from './AgentProvider';
import { startsSpeakerGroup, taskStatusLabel } from './presentation';
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
  const [copied, setCopied] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const messages = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followMessages = useRef(true);
  useLayoutEffect(() => {
    if (messages.current && followMessages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  });
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
  const send = () =>
    execute(() => {
      client.command(text);
      setText('');
    });
  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <aside className="agent-sidebar" aria-label="主控对话">
      <header className="agent-header">
        <span className="agent-mark" aria-hidden="true">
          <Sparkles size={19} strokeWidth={1.8} />
        </span>
        <span className="agent-heading">
          <strong>主控</strong>
          <small>创作搭档</small>
        </span>
        <span className="agent-presence" data-online={state.connection === 'ready' && state.online}>
          <span aria-hidden="true" />
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
                <span className="agent-role-status">
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
      <div className="agent-thread">
        <div
          ref={messages}
          className="agent-messages"
          role="log"
          aria-label="主控消息"
          aria-live="polite"
          onScroll={(event) => {
            const region = event.currentTarget;
            followMessages.current = region.scrollHeight - region.clientHeight - region.scrollTop <= 2;
            setShowLatest(!followMessages.current);
          }}
        >
          {!state.messages.length && (
            <div className="agent-welcome">
              <span className="agent-welcome-mark" aria-hidden="true">
                <Sparkles size={24} />
              </span>
              <h2>从一个想法开始</h2>
              <p>和主控讨论这一期，左侧可以继续编辑。保存与审批仍由你确认。</p>
              <div className="agent-suggestions">
                {['帮我梳理这一期的思路', '看看当前内容有什么可以改进'].map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setText(suggestion);
                      composer.current?.focus();
                    }}
                  >
                    {suggestion}
                    <ArrowUp size={14} aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          )}
          {state.messages.map((message, index) => (
            <article className={`agent-message agent-message-${message.role}`} key={message.id}>
              {startsSpeakerGroup(state.messages, index) && (
                <div className="agent-message-identity">
                  <span className="agent-avatar" aria-hidden="true">
                    {message.role === 'user' ? '你' : <Sparkles size={15} />}
                  </span>
                  <strong>{message.role === 'user' ? '你' : '主控'}</strong>
                </div>
              )}
              <div className="agent-message-body">
                <ReadingText text={message.text} />
              </div>
              <div className="agent-message-meta">
                <time dateTime={message.createdAt}>
                  {Number.isNaN(Date.parse(message.createdAt))
                    ? ''
                    : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
                        new Date(message.createdAt),
                      )}
                </time>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`复制${message.role === 'user' ? '你的' : '主控的'}消息`}
                  onClick={() => void copy(message.id, message.text)}
                >
                  {copied === message.id ? <Check size={14} /> : <Copy size={14} />}
                  {copied === message.id ? '已复制' : '复制'}
                </Button>
              </div>
            </article>
          ))}
          {state.proposals.map((proposal) => (
            <article className="agent-proposal" key={proposal.id}>
              <strong className="agent-proposal-title">
                <Sparkles size={15} aria-hidden="true" /> 草稿建议
              </strong>
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
        {showLatest && (
          <Button
            className="agent-latest"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              followMessages.current = true;
              if (messages.current) messages.current.scrollTop = messages.current.scrollHeight;
              setShowLatest(false);
            }}
          >
            <ArrowDown size={15} aria-hidden="true" /> 最新消息
          </Button>
        )}
      </div>
      {pending.length > 0 && (
        <div className="agent-tasks">
          {pending.map((command) => (
            <div className="agent-task" key={command.id}>
              <span className="agent-task-pulse" data-status={command.status} aria-hidden="true" />
              <span className="agent-task-detail">
                <strong>{taskStatusLabel(command.status)}</strong>
                <small>{command.detail || '正在处理'}</small>
              </span>
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
          if (text.trim() && state.connection !== 'blocked') send();
        }}
      >
        <InputArea
          ref={composer}
          aria-label="给主控的消息"
          placeholder="给主控发消息…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (text.trim() && state.connection !== 'blocked') send();
            }
          }}
          rows={2}
          maxLength={12000}
        />
        <div className="agent-composer-footer">
          <span>Enter 发送 · Shift + Enter 换行</span>
          <Button
            type="submit"
            size="icon"
            aria-label="发送"
            disabled={!text.trim() || state.connection === 'blocked'}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        </div>
      </form>
    </aside>
  );
}
