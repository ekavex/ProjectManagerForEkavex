import type { ProjectDetail } from '@ekavist/shared';
import { useState } from 'react';
import { GanttChart } from '../../components/gantt/GanttChart.js';
import type { Granularity } from '../../components/gantt/geometry.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/primitives.js';
import { useGantt } from '../../lib/queries.js';

export function GanttTab({ project }: { project: ProjectDetail }) {
  const [granularity, setGranularity] = useState<Granularity>('week');
  const { data, isLoading, isError, error, refetch } = useGantt(project.id, { granularity });

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
    />
  );
}
