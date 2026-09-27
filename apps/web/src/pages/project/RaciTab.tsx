/**
 * The RACI matrix (spec section 24).
 *
 * A grid: work items down the side, people across the top. Clicking a cell cycles through
 * Responsible, Accountable, Consulted, Informed and back to blank. The whole grid is saved
 * at once, because that is how it is edited — a partial save would leave a matrix nobody
 * chose.
 */
import type { ProjectDetail, RaciRole } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '../../lib/cn.js';
import { useState } from 'react';
import { useToast } from '../../components/ui/overlays.js';
import { Avatar } from '../../components/ui/page.js';
import { Badge, Button, Card, EmptyState, LoadingState } from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { keys, useRaci } from '../../lib/queries.js';

const CYCLE: (RaciRole | null)[] = [null, 'RESPONSIBLE', 'ACCOUNTABLE', 'CONSULTED', 'INFORMED'];

const LETTER: Record<RaciRole, string> = {
  RESPONSIBLE: 'R',
  ACCOUNTABLE: 'A',
  CONSULTED: 'C',
  INFORMED: 'I',
};

const TONE: Record<RaciRole, string> = {
  RESPONSIBLE: 'bg-accent text-white',
  ACCOUNTABLE: 'bg-danger text-white',
  CONSULTED: 'bg-info-soft text-info',
  INFORMED: 'bg-canvas text-ink-soft',
};

export function RaciTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useRaci(project.id);

  /** Local edits, keyed `rowId:userId`, applied over the server's matrix. */
  const [draft, setDraft] = useState<Map<string, RaciRole | null>>(new Map());
  const canManage = project.capabilities.includes('raci:manage');

  const save = useMutation({
    mutationFn: (
      entries: { userId: string; role: RaciRole; taskId?: string; wbsItemId?: string }[],
    ) => api.put(`/projects/${project.id}/raci`, { entries }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.raci(project.id) });
      setDraft(new Map());
      toast.success('RACI saved.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the matrix.'),
  });

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState />
      </div>
    );
  }

  if (data == null || data.rows.length === 0 || data.members.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Nothing to assign yet"
          description="Add people to the project and create some work before mapping responsibilities."
        />
      </div>
    );
  }

  const roleFor = (rowId: string, userId: string): RaciRole | null => {
    const key = `${rowId}:${userId}`;
    if (draft.has(key)) return draft.get(key) ?? null;
    const row = data.rows.find((candidate) => candidate.id === rowId);
    return row?.cells.find((cell) => cell.userId === userId)?.role ?? null;
  };

  const cycle = (rowId: string, userId: string): void => {
    const current = roleFor(rowId, userId);
    const index = CYCLE.indexOf(current);
    const next = CYCLE[(index + 1) % CYCLE.length] ?? null;
    setDraft((previous) => new Map(previous).set(`${rowId}:${userId}`, next));
  };

  const onSave = (): void => {
    const entries: { userId: string; role: RaciRole; taskId?: string; wbsItemId?: string }[] = [];
    for (const row of data.rows) {
      for (const member of data.members) {
        const role = roleFor(row.id, member.id);
        if (role == null) continue;
        entries.push({
          userId: member.id,
          role,
          ...(row.kind === 'TASK' ? { taskId: row.id } : { wbsItemId: row.id }),
        });
      }
    }
    save.mutate(entries);
  };

  return (
    <Card
      title="RACI"
      description="Responsible does the work. Accountable answers for it — exactly one person per row. Consulted is asked; Informed is told."
      action={
        canManage ? (
          <div className="flex gap-2">
            {draft.size > 0 && (
              <Button size="sm" onClick={() => setDraft(new Map())}>
                Discard changes
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={draft.size === 0}
              loading={save.isPending}
              onClick={onSave}
            >
              Save
            </Button>
          </div>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                Work item
              </th>
              {data.members.map((member) => (
                <th key={member.id} className="border-b border-line px-2 py-2">
                  <span className="flex flex-col items-center gap-1">
                    <Avatar name={member.fullName} size="sm" />
                    <span className="max-w-20 truncate text-[10px] font-medium text-ink-faint">
                      {member.fullName.split(' ')[0]}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`} className="hover:bg-canvas">
                <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Badge tone="neutral">{row.reference}</Badge>
                    <span className="max-w-64 truncate text-[13px]">{row.label}</span>
                  </span>
                </td>
                {data.members.map((member) => {
                  const role = roleFor(row.id, member.id);
                  return (
                    <td key={member.id} className="border-b border-line px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => cycle(row.id, member.id)}
                        aria-label={`${member.fullName} on ${row.reference}: ${role ?? 'not assigned'}`}
                        className={cn(
                          'grid size-7 place-items-center rounded-md text-[12px] font-semibold transition-colors',
                          role == null
                            ? 'border border-dashed border-line-strong text-ink-faint hover:bg-canvas'
                            : TONE[role],
                          !canManage && 'cursor-default',
                        )}
                      >
                        {role == null ? '' : LETTER[role]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
        {(Object.keys(LETTER) as RaciRole[]).map((role) => (
          <span key={role} className="flex items-center gap-1.5">
            <span
              className={cn(
                'grid size-5 place-items-center rounded text-[10px] font-semibold',
                TONE[role],
              )}
            >
              {LETTER[role]}
            </span>
            {role.charAt(0) + role.slice(1).toLowerCase()}
          </span>
        ))}
      </div>
    </Card>
  );
}
