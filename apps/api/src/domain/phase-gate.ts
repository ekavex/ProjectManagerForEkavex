/**
 * The Waterfall phase gate (spec section 5).
 *
 * A phase may require approval before the next one starts. The gate is configurable per
 * phase, so a project can run with no gates at all, or gate only the phases that matter.
 */
import type { PhaseGateStatus, PhaseStatus, TaskStatus } from '@ekavist/shared';

export interface GatePhase {
  id: string;
  sequence: number;
  name: string;
  status: PhaseStatus;
  approvalRequired: boolean;
  gateStatus: PhaseGateStatus;
}

export interface StartDecision {
  canStart: boolean;
  reason: string | null;
}

/**
 * Whether `phase` may begin, given every phase in the project.
 *
 * The rule: walk backwards through the earlier phases. The first one that requires
 * approval and has not been approved blocks everything after it. Phases that were
 * cancelled are skipped — cancelling a phase should not freeze the project.
 */
export function canPhaseStart(phase: GatePhase, allPhases: readonly GatePhase[]): StartDecision {
  if (phase.status === 'CANCELLED') {
    return { canStart: false, reason: 'This phase was cancelled.' };
  }

  const earlier = allPhases
    .filter((candidate) => candidate.sequence < phase.sequence && candidate.status !== 'CANCELLED')
    .sort((a, b) => b.sequence - a.sequence);

  for (const previous of earlier) {
    if (!previous.approvalRequired) continue;
    if (previous.gateStatus === 'APPROVED') continue;

    const detail =
      previous.gateStatus === 'SUBMITTED'
        ? 'is waiting for a decision'
        : previous.gateStatus === 'REJECTED'
          ? 'was rejected and needs rework'
          : 'has not been submitted for approval';
    return {
      canStart: false,
      reason: `Phase ${previous.sequence}, ${previous.name}, ${detail}.`,
    };
  }

  return { canStart: true, reason: null };
}

export interface SubmitCheck {
  canSubmit: boolean;
  reason: string | null;
  incompleteTasks: number;
}

/**
 * Whether a phase may be submitted for approval. Outstanding work is reported but does
 * not prevent submission on its own: a lead may legitimately submit a phase whose
 * remaining tasks were deliberately deferred, and the reviewer sees the count.
 */
export function canSubmitPhase(phase: GatePhase, taskStatuses: readonly TaskStatus[]): SubmitCheck {
  const incomplete = taskStatuses.filter(
    (status) => status !== 'COMPLETED' && status !== 'CANCELLED',
  ).length;

  if (!phase.approvalRequired) {
    return {
      canSubmit: false,
      reason: 'This phase does not require approval. Mark it completed instead.',
      incompleteTasks: incomplete,
    };
  }
  if (phase.gateStatus === 'SUBMITTED') {
    return {
      canSubmit: false,
      reason: 'This phase has already been submitted and is awaiting a decision.',
      incompleteTasks: incomplete,
    };
  }
  if (phase.gateStatus === 'APPROVED') {
    return {
      canSubmit: false,
      reason: 'This phase has already been approved.',
      incompleteTasks: incomplete,
    };
  }
  return { canSubmit: true, reason: null, incompleteTasks: incomplete };
}

/**
 * Who may decide a submitted gate (decision D-008).
 *
 * The gate's named approver decides, falling back to the project lead. When that person is
 * the one who submitted it, the gate escalates to an administrator, because a control a
 * person can clear for themselves is not a control.
 */
export interface ApproverResolution {
  approverId: string | null;
  requiresAdmin: boolean;
}

export function resolveApprover(
  gate: { approverId: string | null; submittedById: string | null },
  projectLeadId: string | null,
): ApproverResolution {
  const approverId = gate.approverId ?? projectLeadId;
  if (approverId == null) return { approverId: null, requiresAdmin: true };
  if (gate.submittedById != null && gate.submittedById === approverId) {
    return { approverId, requiresAdmin: true };
  }
  return { approverId, requiresAdmin: false };
}

/** The phase status that follows a gate decision. */
export function statusAfterDecision(approved: boolean, requiresRework: boolean): PhaseStatus {
  if (approved) return 'APPROVED';
  return requiresRework ? 'REWORK_REQUIRED' : 'IN_PROGRESS';
}

export function gateStatusFor(
  approvalRequired: boolean,
  current: PhaseGateStatus,
): PhaseGateStatus {
  if (!approvalRequired) return 'NOT_REQUIRED';
  return current === 'NOT_REQUIRED' ? 'PENDING' : current;
}
