/**
 * The task table, shared by the project task list, My Work and every dashboard panel.
 *
 * One component means a task looks and behaves the same everywhere: the same status
 * colours, the same overdue treatment, the same progress bar.
 */
import type { TaskSummary } from '@ekavist/shared';
import { cn } from '../lib/cn.js';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, ProgressBar, Table, Td, Th } from './ui/primitives.js';
import { AvatarGroup } from './ui/page.js';
import {
  dueLabel,
  formatDateShort,
  humanise,
  PRIORITY_TONE,
  TASK_STATUS_TONE,
} from '../lib/format.js';

export function TaskTable({
  tasks,
  showProject = false,
  emptyTitle = 'No tasks',
  emptyDescription,
  compact = false,
}: {
  tasks: TaskSummary[];
  showProject?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  compact?: boolean;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDescription != null ? { description: emptyDescription } : {})}
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Task</Th>
          {showProject && <Th>Project</Th>}
          {!compact && <Th>Assignees</Th>}
          <Th>Status</Th>
          {!compact && <Th>Priority</Th>}
          <Th>Due</Th>
          <Th className="w-32">Progress</Th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id} className="hover:bg-canvas">
            <Td>
              <Link
                to={`/projects/${task.project.id}/tasks/${task.id}`}
                className="group flex min-w-0 flex-col"
              >
                <span className="truncate font-medium text-ink group-hover:text-accent">
                  {task.name}
                </span>
                <span className="text-[11px] text-ink-faint">
                  {task.reference}
                  {task.wbs != null && ` · WBS ${task.wbs.code}`}
                  {task.phase != null && ` · ${task.phase.name}`}
                </span>
              </Link>
            </Td>

            {showProject && (
              <Td>
                <Link
                  to={`/projects/${task.project.id}`}
                  className="text-[12px] text-ink-soft hover:text-accent"
                >
                  {task.project.code}
                </Link>
              </Td>
            )}

            {!compact && (
              <Td>
                <AvatarGroup names={task.assignees.map((assignee) => assignee.fullName)} />
              </Td>
            )}

            <Td>
              <Badge tone={TASK_STATUS_TONE[task.status]}>{humanise(task.status)}</Badge>
            </Td>

            {!compact && (
              <Td>
                <Badge tone={PRIORITY_TONE[task.priority]}>{humanise(task.priority)}</Badge>
              </Td>
            )}

            <Td>
              {task.dueDate == null ? (
                <span className="text-[12px] text-ink-faint">No due date</span>
              ) : (
                <span className="flex flex-col">
                  <span className={cn('tabular text-[13px]', task.isOverdue && 'text-danger')}>
                    {formatDateShort(task.dueDate)}
                  </span>
                  <span
                    className={cn(
                      'text-[11px]',
                      task.isOverdue ? 'font-medium text-danger' : 'text-ink-faint',
                    )}
                  >
                    {dueLabel(task.daysUntilDue, task.isOverdue)}
                  </span>
                </span>
              )}
            </Td>

            <Td>
              <ProgressBar
                value={task.progress}
                showLabel
                tone={task.status === 'COMPLETED' ? 'ok' : task.isOverdue ? 'danger' : 'accent'}
              />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** A compact list for dashboard panels, where a full table would be too heavy. */
export function TaskList({
  tasks,
  emptyMessage,
  showProject = false,
}: {
  tasks: TaskSummary[];
  emptyMessage: string;
  showProject?: boolean;
}) {
  if (tasks.length === 0) {
    return <p className="py-6 text-center text-[13px] text-ink-faint">{emptyMessage}</p>;
  }

  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link
            to={`/projects/${task.project.id}/tasks/${task.id}`}
            className="flex items-center gap-3 py-2.5 hover:bg-canvas"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{task.name}</span>
              <span className="block truncate text-[11px] text-ink-faint">
                {task.reference}
                {showProject && ` · ${task.project.code}`}
                {task.dueDate != null && ` · ${formatDateShort(task.dueDate)}`}
              </span>
            </span>
            {task.isOverdue ? (
              <Badge tone="danger">{dueLabel(task.daysUntilDue, true)}</Badge>
            ) : (
              <Badge tone={TASK_STATUS_TONE[task.status]}>{humanise(task.status)}</Badge>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
