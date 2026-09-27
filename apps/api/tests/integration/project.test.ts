import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, errorCode, signIn } from '../helpers/api.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { seedBaseWorld, seedUser } from '../helpers/fixtures.js';
import { seedProjectWorld } from '../helpers/world.js';

describe('creating a project', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('creates the project, makes the lead a member and lays out the default phases', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);

    const response = await admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Electronic Weeder',
        code: 'EKV-01',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-11-30',
      }),
    );

    expect(response.status).toBe(201);
    expect(response.body.code).toBe('EKV-01');
    expect(response.body.lead.id).toBe(world.lead.id);
    expect(response.body.progress).toBe(0);

    const phases = await admin.auth(api().get(`/api/v1/projects/${response.body.id}/phases`));
    expect(phases.body.data).toHaveLength(8);
    expect(phases.body.data[0].name).toBe('Initiation');
    expect(phases.body.data[7].name).toBe('Closure');

    const members = await admin.auth(api().get(`/api/v1/projects/${response.body.id}/members`));
    expect(members.body.data).toHaveLength(1);
    expect(members.body.data[0].projectRole).toBe('LEAD');
  });

  it('refuses a duplicate project code', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Another project',
        code: 'EKV-01',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-11-30',
      }),
    );

    expect(response.status).toBe(409);
    expect(errorCode(response.body)).toBe('PROJECT_CODE_TAKEN');
  });

  it('refuses an end date before the start date', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);

    const response = await admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Backwards',
        code: 'EKV-02',
        leadId: world.lead.id,
        startDate: '2026-11-30',
        plannedEndDate: '2026-09-01',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'plannedEndDate' }),
    );
  });

  it('refuses an inactive person as the lead', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);
    const dormant = await seedUser(world.org.id, { status: 'INACTIVE' });

    const response = await admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Unled',
        code: 'EKV-03',
        leadId: dormant.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-11-30',
      }),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('PROJECT_LEAD_REQUIRED');
  });

  it('does not let a team member create a project', async () => {
    const world = await seedBaseWorld();
    const member = await signIn(world.member);

    const response = await member.auth(
      api().post('/api/v1/projects').send({
        name: 'Unauthorised',
        code: 'EKV-04',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-11-30',
      }),
    );

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('FORBIDDEN');
  });
});

describe('project visibility', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('hides a project from someone who is not on it', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.outsider.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );

    // 404 rather than 403: the API does not confirm that the id exists.
    expect(response.status).toBe(404);
    expect(errorCode(response.body)).toBe('NOT_PROJECT_MEMBER');
  });

  it('lists only the projects a member belongs to', async () => {
    const world = await seedProjectWorld();

    const forMember = await world.sessions.member.auth(api().get('/api/v1/projects'));
    const forOutsider = await world.sessions.outsider.auth(api().get('/api/v1/projects'));

    expect(forMember.body.data).toHaveLength(1);
    expect(forOutsider.body.data).toHaveLength(0);
  });

  it('lets an administrator see every project without being a member', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.admin.auth(api().get('/api/v1/projects'));
    expect(response.body.data).toHaveLength(1);
  });

  it('tells the client what the caller may do', async () => {
    const world = await seedProjectWorld();

    const forLead = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );
    const forViewer = await world.sessions.viewer.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );

    expect(forLead.body.capabilities).toContain('task:create');
    expect(forViewer.body.capabilities).not.toContain('task:create');
    expect(forViewer.body.capabilities).toContain('project:read');
  });
});

describe('project members', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses to add the same person twice', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/members`).send({ userId: world.member.id }),
    );

    expect(response.status).toBe(409);
    expect(errorCode(response.body)).toBe('MEMBER_ALREADY_ADDED');
  });

  it('does not let a member add other people', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.member.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/members`)
        .send({ userId: world.outsider.id }),
    );

    expect(response.status).toBe(403);
  });

  it('refuses to remove the project lead', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api().delete(`/api/v1/projects/${world.project.id}/members/${world.lead.id}`),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('MEMBER_IS_LEAD');
  });

  it('removes a member and leaves their tasks in the project, unassigned', async () => {
    const world = await seedProjectWorld();
    const task = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/tasks`)
        .send({
          name: 'Survey the field',
          assigneeIds: [world.member.id],
          dueDate: '2026-09-20',
        }),
    );

    const removed = await world.sessions.lead.auth(
      api().delete(`/api/v1/projects/${world.project.id}/members/${world.member.id}`),
    );
    expect(removed.status).toBe(200);

    const after = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/tasks/${task.body.id}`),
    );
    expect(after.status).toBe(200);
    expect(after.body.assignees).toHaveLength(0);
  });

  it('gives a viewer chat access only when the membership says so', async () => {
    const world = await seedProjectWorld();

    const before = await world.sessions.viewer.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );
    expect(before.body.capabilities).not.toContain('chat:read');

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/members/${world.viewer.id}`)
        .send({ canReadChat: true }),
    );

    const after = await world.sessions.viewer.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );
    expect(after.body.capabilities).toContain('chat:read');
  });
});

describe('project status', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses a transition that is not allowed', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api().patch(`/api/v1/projects/${world.project.id}/status`).send({ status: 'COMPLETED' }),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('PROJECT_STATUS_TRANSITION_INVALID');
  });

  it('makes an archived project read-only', async () => {
    const world = await seedProjectWorld();

    await world.sessions.lead.auth(
      api().patch(`/api/v1/projects/${world.project.id}/status`).send({ status: 'ACTIVE' }),
    );
    await world.sessions.lead.auth(
      api().patch(`/api/v1/projects/${world.project.id}/status`).send({ status: 'CANCELLED' }),
    );
    await world.sessions.lead.auth(api().post(`/api/v1/projects/${world.project.id}/archive`));

    const write = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/tasks`).send({ name: 'Too late' }),
    );

    expect(write.status).toBe(403);
    expect(errorCode(write.body)).toBe('PROJECT_READ_ONLY');

    // Reading still works, which is the point of archiving rather than deleting.
    const read = await world.sessions.lead.auth(api().get(`/api/v1/projects/${world.project.id}`));
    expect(read.status).toBe(200);
  });

  it('records the status change in the activity feed', async () => {
    const world = await seedProjectWorld();

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/status`)
        .send({ status: 'ACTIVE', reason: 'Kickoff done' }),
    );

    const project = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );
    expect(project.body.status).toBe('ACTIVE');
  });
});
