/**
 * Project status transitions.
 *
 * The map is explicit rather than "anything goes" so that a project cannot jump from
 * DRAFT straight to COMPLETED, which would leave the phase and closure records empty.
 *
 * A live project never becomes COMPLETED through the status route: completion goes through
 * the closure workflow, which checks the closure checklist (business rule 19). The only
 * route to COMPLETED here is restoring an archived project that had already been closed.
 */
import type { ProjectStatus } from '@ekavist/shared';

const TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ['PLANNED', 'ACTIVE', 'CANCELLED'],
  PLANNED: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'AT_RISK', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'AT_RISK', 'CANCELLED'],
  AT_RISK: ['ACTIVE', 'ON_HOLD', 'CANCELLED'],
  COMPLETED: ['ARCHIVED', 'ACTIVE'],
  CANCELLED: ['ARCHIVED', 'DRAFT'],
  ARCHIVED: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
};

export function allowedProjectTransitions(from: ProjectStatus): readonly ProjectStatus[] {
  return TRANSITIONS[from];
}

/** Whether `from` may complete through the closure workflow. */
export function canCloseFrom(from: ProjectStatus): boolean {
  return from === 'ACTIVE' || from === 'AT_RISK';
}
