/**
 * Project lifecycle and task rules added after the first release: completion through the
 * closure checklist, lessons learned, project templates, completion criteria, every
 * dependency type, and the refusal of status changes through the generic task update.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, errorCode } from '../helpers/api.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createTask, seedProjectWorld, type ProjectWorld } from '../helpers/world.js';

afterAll(async () => {
  await closeDatabase();
});

const projectUrl = (world: ProjectWorld, suffix = '') =>
  `/api/v1/projects/${world.project.id}${suffix}`;

async function activate(world: ProjectWorld) {
  const response = await world.sessions.lead.auth(
    api().patch(projectUrl(world, '/status')).send({ status: 'ACTIVE' }),
  );
  expect(response.status).toBe(200);
}

describe('project status and closure', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('tells the client which statuses it may move to', async () => {
    const world = await seedProjectWorld();
    expect(world.project.allowedStatuses).toEqual(['PLANNED', 'ACTIVE', 'CANCELLED']);
    expect(world.project.completionRules).toEqual({
      requiresNote: false,
      requiresActualHours: false,
      requiresAttachment: false,
    });
  });

  it('refuses to complete a live project through the status route', async () => {
    const world = await seedProjectWorld();
    await activate(world);

    const response = await world.sessions.lead.auth(
      api().patch(projectUrl(world, '/status')).send({ status: 'COMPLETED' }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('closure checklist');
  });

  it('refuses to close a project that is not active', async () => {
    const world = await seedProjectWorld();
    const response = await world.sessions.lead.auth(
      api().post(projectUrl(world, '/closure')).send({ acknowledgeOpenItems: true }),
    );
    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('PROJECT_STATUS_TRANSITION_INVALID');
  });

  it('closes through the checklist, keeps lessons open, then archives and restores', async () => {
    const world = await seedProjectWorld();
    await activate(world);

    const handover = await world.sessions.lead.auth(
      api().patch(projectUrl(world)).send({ handoverNote: 'Handed to operations on site.' }),
    );
    expect(handover.body.handoverNote).toBe('Handed to operations on site.');

    const lesson = await world.sessions.lead.auth(
      api()
        .post(projectUrl(world, '/lessons'))
        .send({ category: 'WHAT_WENT_WELL', note: 'Weekly demos kept the client close.' }),
    );
    expect(lesson.status).toBe(201);

    const checklist = await world.sessions.lead.auth(api().get(projectUrl(world, '/closure')));
    const items = checklist.body.items as { key: string; satisfied: boolean }[];
    expect(items.find((item) => item.key === 'HANDOVER')?.satisfied).toBe(true);
    expect(items.find((item) => item.key === 'LESSONS')?.satisfied).toBe(true);

    const closed = await world.sessions.lead.auth(
      api().post(projectUrl(world, '/closure')).send({ acknowledgeOpenItems: true }),
    );
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('COMPLETED');
    expect(closed.body.closedAt).not.toBeNull();

    // Lessons are often understood only after the end, so a completed project accepts them.
    const late = await world.sessions.lead.auth(
      api()
        .post(projectUrl(world, '/lessons'))
        .send({ category: 'PROCESS', note: 'Gate earlier.' }),
    );
    expect(late.status).toBe(201);

    // A member may read lessons but not write them.
    const memberWrite = await world.sessions.member.auth(
      api().post(projectUrl(world, '/lessons')).send({ category: 'TEAM', note: 'Nope' }),
    );
    expect(memberWrite.status).toBe(403);
    const memberRead = await world.sessions.member.auth(api().get(projectUrl(world, '/lessons')));
    expect(memberRead.body.data).toHaveLength(2);

    const archived = await world.sessions.lead.auth(api().post(projectUrl(world, '/archive')));
    expect(archived.body.status).toBe('ARCHIVED');
    expect(archived.body.allowedStatuses).toContain('COMPLETED');

    const blocked = await world.sessions.lead.auth(
      api().post(projectUrl(world, '/lessons')).send({ category: 'TEAM', note: 'Too late' }),
    );
    expect(errorCode(blocked.body)).toBe('PROJECT_READ_ONLY');

    const restored = await world.sessions.lead.auth(
      api().patch(projectUrl(world, '/status')).send({ status: 'COMPLETED' }),
    );
    expect(restored.status).toBe(200);
    expect(restored.body.archivedAt).toBeNull();
  });

  it('lets the lead remove a lesson', async () => {
    const world = await seedProjectWorld();
    const lesson = await world.sessions.lead.auth(
      api().post(projectUrl(world, '/lessons')).send({ category: 'TECHNICAL', note: 'Typo' }),
    );
    const removed = await world.sessions.lead.auth(
      api().delete(projectUrl(world, `/lessons/${lesson.body.id}`)),
    );
    expect(removed.status).toBe(204);
    const list = await world.sessions.lead.auth(api().get(projectUrl(world, '/lessons')));
    expect(list.body.data).toHaveLength(0);
  });
});

describe('project templates', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('copies the plan, shifted to the new start date, without people or progress', async () => {
    const world = await seedProjectWorld();
    const first = await createTask(world, { name: 'Survey the field' });
    const second = await createTask(world, {
      name: 'Build the rig',
      startDate: '2026-09-13',
      dueDate: '2026-09-20',
    });
    await world.sessions.lead.auth(
      api()
        .post(projectUrl(world, '/dependencies'))
        .send({ predecessorId: first.id, successorId: second.id }),
    );
    await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${first.id}/status`))
        .send({ status: 'IN_PROGRESS' }),
    );
    await world.sessions.lead.auth(
      api()
        .post(projectUrl(world, '/milestones'))
        .send({ name: 'Rig ready', date: '2026-09-20', taskIds: [second.id] }),
    );

    const created = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Weeder, second site',
        code: 'EKV-02',
        leadId: world.lead.id,
        startDate: '2026-10-01',
        plannedEndDate: '2026-12-31',
        templateProjectId: world.project.id,
      }),
    );
    expect(created.status).toBe(201);
    const copyUrl = `/api/v1/projects/${created.body.id}`;

    const phases = await world.sessions.lead.auth(api().get(`${copyUrl}/phases`));
    expect(phases.body.data).toHaveLength(8);

    const tasks = await world.sessions.lead.auth(
      api().get(`${copyUrl}/tasks`).query({ sort: 'reference' }),
    );
    expect(tasks.status).toBe(200);
    const copied = tasks.body.data as {
      reference: string;
      name: string;
      status: string;
      progress: number;
      startDate: string;
      dueDate: string;
      assignees: unknown[];
    }[];
    expect(copied.map((task) => task.name).sort()).toEqual(['Build the rig', 'Survey the field']);
    const survey = copied.find((task) => task.name === 'Survey the field');
    // 2026-09-01 to 2026-10-01 is 30 days.
    expect(survey?.startDate).toBe('2026-10-05');
    expect(survey?.dueDate).toBe('2026-10-12');
    expect(survey?.status).toBe('NOT_STARTED');
    expect(survey?.progress).toBe(0);
    expect(survey?.assignees).toEqual([]);

    const dependencies = await world.sessions.lead.auth(api().get(`${copyUrl}/dependencies`));
    expect(dependencies.body.data).toHaveLength(1);

    const milestones = await world.sessions.lead.auth(api().get(`${copyUrl}/milestones`));
    expect(milestones.body.data[0].date).toBe('2026-10-20');
  });

  it('will not copy a project the creator cannot see', async () => {
    const world = await seedProjectWorld();
    const created = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Ghost',
        code: 'GHOST',
        leadId: world.lead.id,
        startDate: '2026-10-01',
        plannedEndDate: '2026-12-31',
        templateProjectId: 'does-not-exist',
      }),
    );
    expect(created.status).toBe(404);
  });
});

describe('task rules', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses a status sent through the generic task update instead of ignoring it', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);
    const response = await world.sessions.lead.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}`))
        .send({ status: 'COMPLETED' }),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('/status');
  });

  it('sorts the task list by any allowed column, not only by dates', async () => {
    const world = await seedProjectWorld();
    await createTask(world, { name: 'Beta' });
    await createTask(world, { name: 'Alpha', dueDate: undefined, startDate: undefined });
    for (const sort of ['name', 'reference', 'priority', 'status', 'progress', 'createdAt']) {
      const response = await world.sessions.lead.auth(
        api().get(projectUrl(world, '/tasks')).query({ sort, direction: 'desc' }),
      );
      expect(response.status, sort).toBe(200);
    }
    const byName = await world.sessions.lead.auth(
      api().get(projectUrl(world, '/tasks')).query({ sort: 'name' }),
    );
    expect(byName.body.data.map((task: { name: string }) => task.name)).toEqual(['Alpha', 'Beta']);
  });

  it('applies the completion criteria to both the status and the progress routes', async () => {
    const world = await seedProjectWorld();
    await world.sessions.lead.auth(
      api()
        .patch(projectUrl(world))
        .send({ completionRequiresNote: true, completionRequiresActualHours: true }),
    );
    const task = await createTask(world);

    const bare = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}/status`))
        .send({ status: 'COMPLETED' }),
    );
    expect(bare.status).toBe(422);
    expect(errorCode(bare.body)).toBe('TASK_COMPLETION_CRITERIA_UNMET');
    expect(bare.body.error.details).toHaveLength(2);

    const viaProgress = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}/progress`))
        .send({ progress: 100 }),
    );
    expect(errorCode(viaProgress.body)).toBe('TASK_COMPLETION_CRITERIA_UNMET');

    const complete = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}/status`))
        .send({ status: 'COMPLETED', note: 'Signed off by the client', actualHours: 7.5 }),
    );
    expect(complete.status).toBe(200);
    expect(complete.body.actualHours).toBe(7.5);
  });

  it('asks for an attachment when the project requires one', async () => {
    const world = await seedProjectWorld();
    await world.sessions.lead.auth(
      api().patch(projectUrl(world)).send({ completionRequiresAttachment: true }),
    );
    const task = await createTask(world);
    const refused = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}/status`))
        .send({ status: 'COMPLETED' }),
    );
    expect(errorCode(refused.body)).toBe('TASK_COMPLETION_CRITERIA_UNMET');

    await world.sessions.member.auth(
      api()
        .post(projectUrl(world, `/tasks/${task.id}/attachments`))
        .send({ name: 'Test report', url: 'https://example.com/report' }),
    );
    const accepted = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}/status`))
        .send({ status: 'COMPLETED' }),
    );
    expect(accepted.status).toBe(200);
  });

  it('accepts every dependency type and warns on Finish-to-Finish at completion', async () => {
    const world = await seedProjectWorld();
    const a = await createTask(world, { name: 'Wiring' });
    const b = await createTask(world, { name: 'Wiring inspection' });

    const link = await world.sessions.lead.auth(
      api()
        .post(projectUrl(world, '/dependencies'))
        .send({ predecessorId: a.id, successorId: b.id, type: 'FINISH_TO_FINISH' }),
    );
    expect(link.status).toBe(201);

    // Starting is fine under Finish-to-Finish...
    const started = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${b.id}/status`))
        .send({ status: 'IN_PROGRESS' }),
    );
    expect(started.status).toBe(200);

    // ...finishing first is not, unless confirmed.
    const finished = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${b.id}/status`))
        .send({ status: 'COMPLETED' }),
    );
    expect(errorCode(finished.body)).toBe('TASK_PREDECESSOR_INCOMPLETE');
    expect(finished.body.error.message).toContain('has not finished yet');

    const confirmed = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${b.id}/status`))
        .send({ status: 'COMPLETED', overridePredecessorWarning: true }),
    );
    expect(confirmed.status).toBe(200);
  });

  it('warns on Start-to-Start only until the predecessor has started', async () => {
    const world = await seedProjectWorld();
    const a = await createTask(world, { name: 'Pour foundation' });
    const b = await createTask(world, { name: 'Level foundation' });
    await world.sessions.lead.auth(
      api()
        .post(projectUrl(world, '/dependencies'))
        .send({ predecessorId: a.id, successorId: b.id, type: 'START_TO_START' }),
    );

    const early = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${b.id}/progress`))
        .send({ progress: 20 }),
    );
    expect(errorCode(early.body)).toBe('TASK_PREDECESSOR_INCOMPLETE');

    await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${a.id}/status`))
        .send({ status: 'IN_PROGRESS' }),
    );
    const later = await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${b.id}/progress`))
        .send({ progress: 20 }),
    );
    expect(later.status).toBe(200);
  });
});

describe('gantt', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('draws a task that has only a due date as a one-day bar on that date', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world, { startDate: undefined, dueDate: '2026-09-20' });
    const gantt = await world.sessions.lead.auth(api().get(projectUrl(world, '/gantt')));
    const bar = gantt.body.bars.find((entry: { id: string }) => entry.id === task.id);
    expect(bar).toMatchObject({ start: '2026-09-20', end: '2026-09-20' });
  });
});

describe('project dashboard planning figures', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reports workstreams per phase and earned value in hours', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world, {
      startDate: '2026-01-01',
      dueDate: '2026-01-10',
      estimatedHours: 10,
    });
    await world.sessions.member.auth(
      api()
        .patch(projectUrl(world, `/tasks/${task.id}/progress`))
        .send({ progress: 50, actualHours: 4 }),
    );

    const dashboard = await world.sessions.lead.auth(api().get(projectUrl(world, '/dashboard')));
    expect(dashboard.status).toBe(200);
    const requirements = dashboard.body.workstreams.find(
      (row: { name: string }) => row.name === 'Requirements',
    );
    expect(requirements).toMatchObject({ total: 1, inProgress: 1, progress: 50 });
    expect(dashboard.body.workstreams).toHaveLength(8);

    expect(dashboard.body.earnedValue).toMatchObject({
      unit: 'HOURS',
      budgetAtCompletion: 10,
      plannedValue: 10,
      earnedValue: 5,
      actualCost: 4,
      spi: 0.5,
      cpi: 1.25,
    });
  });
});
