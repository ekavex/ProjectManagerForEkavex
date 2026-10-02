import type { ProjectDetail } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { GanttChart } from '../../components/gantt/GanttChart.js';
import type { Granularity } from '../../components/gantt/geometry.js';
import { useToast } from '../../components/ui/overlays.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { useGantt } from '../../lib/queries.js';

export function GanttTab({ project }: { project: ProjectDetail }) {
  const [granularity, setGranularity] = useState<Granularity>('week');
  const { data, isLoading, isError, error, refetch } = useGantt(project.id, { granularity });
  const queryClient = useQueryClient();
  const toast = useToast();

  // Changing dates here is an ordinary task update (spec section 22: "changing task dates
  // should update the Gantt automatically"); the refetch redraws every dependent bar.
  const reschedule = useMutation({
    mutationFn: ({ taskId, start, end }: { taskId: string; start: string; end: string }) =>
      api.patch(`/projects/${project.id}/tasks/${taskId}`, { startDate: start, dueDate: end }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['projects', project.id] }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not move the task.'),
  });
  const canReschedule = project.capabilities.includes('task:update') && project.archivedAt == null;

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState label="Building the timeline…" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data == null || data.bars.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Nothing to plot yet"
          description="Add phases, a WBS and some dated tasks, and they will appear here."
        />
      </div>
    );
  }

  return (
    <GanttChart
      data={data}
      projectId={project.id}
      granularity={granularity}
      onGranularityChange={setGranularity}
      {...(canReschedule
        ? {
            onReschedule: (taskId: string, dates: { start: string; end: string }) =>
              reschedule.mutate({ taskId, ...dates }),
          }
        : {})}
    />
  );
}
