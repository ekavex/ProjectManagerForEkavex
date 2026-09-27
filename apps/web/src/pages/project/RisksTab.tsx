/**
 * The risk register (spec section 44).
 *
 * Severity is not a field anyone types: it comes from probability and impact, calculated
 * on the server. The form therefore shows what the severity *will* be as the two inputs
 * change, so the person entering it understands the matrix rather than arguing with it.
 */
import type { CreateRiskInput, ProjectDetail, RiskLevel, RiskStatus } from '@ekavist/shared';
import { RISK_LEVELS, RISK_STATUSES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import { FilterBar, Pagination } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise, RISK_STATUS_TONE, RISK_TONE } from '../../lib/format.js';
import { useMembers, usePhases, useRisks } from '../../lib/queries.js';

/** Mirrors `apps/api/src/domain/risk.ts`, purely so the form can preview the outcome. */
const MATRIX: Record<RiskLevel, Record<RiskLevel, RiskLevel>> = {
  LOW: { LOW: 'LOW', MEDIUM: 'LOW', HIGH: 'MEDIUM', VERY_HIGH: 'HIGH' },
  MEDIUM: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', VERY_HIGH: 'HIGH' },
  HIGH: { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'HIGH', VERY_HIGH: 'VERY_HIGH' },
  VERY_HIGH: { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'VERY_HIGH', VERY_HIGH: 'VERY_HIGH' },
};

export function RisksTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RiskStatus | ''>('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError, error, refetch } = useRisks(project.id, {
    page,
    pageSize: 25,
    status: status === '' ? undefined : status,
  });

  const canManage = project.capabilities.includes('risk:manage');

  const update = useMutation({
    mutationFn: ({ riskId, body }: { riskId: string; body: Record<string, unknown> }) =>
      api.patch(`/projects/${project.id}/risks/${riskId}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects', project.id] }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the risk.'),
  });

  const remove = useMutation({
    mutationFn: (riskId: string) => api.delete(`/projects/${project.id}/risks/${riskId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Risk removed.');
    },
  });

  return (
    <>
      <FilterBar>
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as RiskStatus | '');
            setPage(1);
          }}
          className="w-44"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {RISK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        {canManage && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            Add risk
          </Button>
        )}
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title="No risks recorded"
            description="A risk is something that has not happened yet but would hurt if it did."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Risk</Th>
                  <Th>Probability</Th>
                  <Th>Impact</Th>
                  <Th>Severity</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  <Th>Due</Th>
                  {canManage && <Th />}
                </tr>
              </thead>
              <tbody>
                {data.data.map((risk) => (
                  <tr key={risk.id} className="hover:bg-canvas">
                    <Td>
                      <span className="flex items-center gap-2">
                        <Badge tone="neutral">{risk.reference}</Badge>
                        <span className="font-medium">{risk.title}</span>
                      </span>
                      {risk.mitigation != null && (
                        <span className="mt-0.5 block text-[12px] text-ink-faint">
                          Mitigation: {risk.mitigation}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={RISK_TONE[risk.probability]}>{humanise(risk.probability)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={RISK_TONE[risk.impact]}>{humanise(risk.impact)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={RISK_TONE[risk.severity]}>{humanise(risk.severity)}</Badge>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {risk.owner?.fullName ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      {canManage ? (
                        <Select
                          value={risk.status}
                          className="h-8 w-32"
                          aria-label={`Status for ${risk.reference}`}
                          onChange={(event) =>
                            update.mutate({
                              riskId: risk.id,
                              body: { status: event.target.value },
                            })
                          }
                        >
                          {RISK_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {humanise(value)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={RISK_STATUS_TONE[risk.status]}>{humanise(risk.status)}</Badge>
                      )}
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">{formatDate(risk.dueDate)}</span>
                    </Td>
                    {canManage && (
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void confirm({
                              title: `Remove ${risk.reference}?`,
                              message: 'This removes the risk from the register permanently.',
                              confirmLabel: 'Remove',
                            }).then((ok) => {
                              if (ok) remove.mutate(risk.id);
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <RiskModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function RiskModal({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: members } = useMembers(project.id);
  const { data: phases } = usePhases(project.id);

  const [form, setForm] = useState<Partial<CreateRiskInput>>({
    probability: 'MEDIUM',
    impact: 'MEDIUM',
    status: 'OPEN',
  });

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/risks`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Risk added.');
      setForm({ probability: 'MEDIUM', impact: 'MEDIUM', status: 'OPEN' });
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the risk.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  const preview = MATRIX[form.probability ?? 'MEDIUM'][form.impact ?? 'MEDIUM'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a risk"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="risk-form" loading={create.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id="risk-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Risk" htmlFor="risk-title" required>
          <Input
            id="risk-title"
            required
            autoFocus
            value={form.title ?? ''}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="risk-description">
          <Textarea
            id="risk-description"
            rows={2}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Probability" htmlFor="risk-probability">
            <Select
              id="risk-probability"
              value={form.probability ?? 'MEDIUM'}
              onChange={(event) =>
                setForm({ ...form, probability: event.target.value as RiskLevel })
              }
            >
              {RISK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Impact" htmlFor="risk-impact">
            <Select
              id="risk-impact"
              value={form.impact ?? 'MEDIUM'}
              onChange={(event) => setForm({ ...form, impact: event.target.value as RiskLevel })}
            >
              {RISK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <p className="flex items-center gap-2 rounded-md bg-canvas px-3 py-2 text-[13px] text-ink-soft">
          Severity will be
          <Badge tone={RISK_TONE[preview]}>{humanise(preview)}</Badge>
          <span className="text-[12px] text-ink-faint">
            — calculated from probability and impact, not entered by hand.
          </span>
        </p>

        <Field
          label="Mitigation"
          htmlFor="risk-mitigation"
          hint="What reduces the chance of it happening."
        >
          <Textarea
            id="risk-mitigation"
            rows={2}
            value={form.mitigation ?? ''}
            onChange={(event) => setForm({ ...form, mitigation: event.target.value })}
          />
        </Field>

        <Field
          label="Contingency"
          htmlFor="risk-contingency"
          hint="What we do if it happens anyway."
        >
          <Textarea
            id="risk-contingency"
            rows={2}
            value={form.contingency ?? ''}
            onChange={(event) => setForm({ ...form, contingency: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner" htmlFor="risk-owner">
            <Select
              id="risk-owner"
              value={form.ownerId ?? ''}
              onChange={(event) => setForm({ ...form, ownerId: event.target.value || undefined })}
            >
              <option value="">No owner</option>
              {(members ?? []).map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Review by" htmlFor="risk-due">
            <Input
              id="risk-due"
              type="date"
              value={form.dueDate ?? ''}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Phase" htmlFor="risk-phase">
          <Select
            id="risk-phase"
            value={form.phaseId ?? ''}
            onChange={(event) => setForm({ ...form, phaseId: event.target.value || undefined })}
          >
            <option value="">No phase</option>
            {(phases ?? []).map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
