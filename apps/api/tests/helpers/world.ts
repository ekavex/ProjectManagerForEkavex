/**
 * A ready-made project for integration tests: an admin, a lead, two members, a viewer and
 * an outsider, plus a project with the eight default phases.
 *
 * Everything is created through the API, so a test can never set up a state the
 * application itself would refuse to create.
 */
import type { ProjectDetail } from '@ekavist/shared';
import { api, signIn, type Session } from './api.js';
import { seedBaseWorld, type BaseWorld } from './fixtures.js';

export interface ProjectWorld extends BaseWorld {
  sessions: {
    admin: Session;
    lead: Session;
    member: Session;
    otherMember: Session;
    viewer: Session;
    outsider: Session;
  };
  project: ProjectDetail;
  phaseIds: string[];
}

export async function seedProjectWorld(
  options: { withDefaultPhases?: boolean } = {},
): Promise<ProjectWorld> {
  const world = await seedBaseWorld();

  const sessions = {
    admin: await signIn(world.admin),
    lead: await signIn(world.lead),
    member: await signIn(world.member),
    otherMember: await signIn(world.otherMember),
    viewer: await signIn(world.viewer),
    outsider: await signIn(world.outsider),
  };

  const created = await sessions.admin.auth(
    api()
      .post('/api/v1/projects')
      .send({
        name: 'AI-Based Electronic Weeder',
        code: 'EKV-01',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-11-30',
        priority: 'HIGH',
        objectives: ['Reduce manual weeding effort'],
        deliverables: ['Working prototype'],
        useDefaultPhases: options.withDefaultPhases !== false,
      }),
  );

  if (created.status !== 201) {
    throw new Error(`Could not create the fixture project: ${JSON.stringify(created.body)}`);
  }
  const project = created.body as ProjectDetail;

  // The lead adds the team, exactly as they would in the product.
  for (const user of [world.member, world.otherMember]) {
    const response = await sessions.lead.auth(
      api().post(`/api/v1/projects/${project.id}/members`).send({ userId: user.id }),
    );
    if (response.status !== 201) {
      throw new Error(`Could not add ${user.email}: ${JSON.stringify(response.body)}`);
    }
  }

  const viewerResponse = await sessions.lead.auth(
    api()
      .post(`/api/v1/projects/${project.id}/members`)
      .send({ userId: world.viewer.id, projectRole: 'VIEWER' }),
  );
  if (viewerResponse.status !== 201) {
    throw new Error(`Could not add the viewer: ${JSON.stringify(viewerResponse.body)}`);
  }

  const phases = await sessions.lead.auth(api().get(`/api/v1/projects/${project.id}/phases`));
  const phaseIds = (phases.body.data as { id: string }[]).map((phase) => phase.id);

  return { ...world, sessions, project, phaseIds };
}

/** Creates a task as the lead and returns it. */
export async function createTask(
  world: ProjectWorld,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; reference: string; name: string }> {
  const response = await world.sessions.lead.auth(
    api()
      .post(`/api/v1/projects/${world.project.id}/tasks`)
      .send({
        name: 'Draft the requirements',
        phaseId: world.phaseIds[1],
        assigneeIds: [world.member.id],
        startDate: '2026-09-05',
        dueDate: '2026-09-12',
        estimatedHours: 8,
        ...overrides,
      }),
  );

  if (response.status !== 201) {
    throw new Error(`Could not create the task: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}
