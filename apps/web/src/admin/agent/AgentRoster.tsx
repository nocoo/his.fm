import type { ConversationStatus } from '@his-fm/contracts';
import { Button } from '@nocoo/basalt';
import { Popover, PopoverContent, PopoverTrigger } from '@nocoo/basalt/components/popover';
import { PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { presentConversations } from './presentation';

export function AgentRoster({
  conversations,
  visible,
}: {
  conversations: ConversationStatus[];
  visible: boolean;
}) {
  const roles = presentConversations(conversations);
  const [selected, setSelected] = useState<string | null>(null);
  if (!roles.length) return null;
  return (
    <section className="agent-roster" aria-label={`运行角色 · ${roles.length}`}>
      {roles.map((role) => {
        const Icon =
          role.kind === 'coordinator' ? Sparkles : role.kind === 'reviewer' ? ShieldCheck : PenLine;
        return (
          <Popover
            key={role.id}
            open={visible && selected === role.id}
            onOpenChange={(open) => setSelected(open ? role.id : null)}
          >
            <PopoverTrigger asChild>
              <Button
                className="agent-role"
                variant="ghost"
                size="sm"
                data-status={role.status}
                aria-label={`${role.role} · ${role.statusLabel} · ${role.task}`}
              >
                <span className="agent-role-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="agent-role-name">{role.role}</span>
                <span className="agent-role-status">
                  <span aria-hidden="true" />
                  {role.statusLabel}
                </span>
                <span className="agent-role-task">{role.task}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="agent-role-popover"
              side="bottom"
              align="start"
              collisionPadding={12}
              aria-label={`${role.role}任务详情`}
            >
              <strong>
                {role.role} · {role.statusLabel}
              </strong>
              <p>{role.task}</p>
            </PopoverContent>
          </Popover>
        );
      })}
    </section>
  );
}
