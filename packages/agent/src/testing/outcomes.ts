import { assistantMessage, toolCall } from '@frogie/core/testing';
import type { fixture } from './fixtures.ts';

export const successfulResult = (markdown: string) => ({
  markdown,
  outcome: 'done',
  evidence: ['Verified test deliverable'],
});

export function acceptWork(test: Awaited<ReturnType<typeof fixture>>, markdown = '已验收完成') {
  return [
    async () => {
      const assignments = Object.values((await test.runtime.work()).assignments);
      const active = test.store.next()?.commandId;
      const accepted = assignments.filter((assignment) => assignment.commandId === active);
      return assistantMessage(
        accepted.length
          ? accepted.map((assignment) => toolCall('inspect_work', { id: assignment.id }))
          : [toolCall('read_latest', {})],
        { stopReason: 'toolUse' },
      );
    },
    async () => {
      const assignments = Object.values((await test.runtime.work()).assignments);
      const active = test.store.next()?.commandId;
      const accepted = assignments.filter((assignment) => assignment.commandId === active);
      return assistantMessage(
        [
          toolCall('finish_command', {
            markdown,
            outcome: 'done',
            acceptedAssignmentIds: accepted.map((assignment) => assignment.id),
            checks: accepted.flatMap((assignment) =>
              assignment.requiredCriteria.map((criterion) => ({
                assignmentId: assignment.id,
                criterion,
                evidence: assignment.outcome?.evidence ?? [],
              })),
            ),
          }),
        ],
        { stopReason: 'toolUse' },
      );
    },
  ];
}
