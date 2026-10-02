/**
 * Capacity, calendar and CSV exports, and the workload report's project filter.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDaysTo, today } from '../../src/domain/time.js';
import { mondayOf } from '../../src/domain/working-days.js';
import { api } from '../helpers/api.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createTask, seedProjectWorld } from '../helpers/world.js';

afterAll(async () => {
  await closeDatabase();
});

describe('capacity', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('sets remaining estimated hours against working hours, week by week', async () => {
    const world = await seedProjectWorld();
    // Draft projects are tentative and do not count against anyone's capacity.
    await world.sessions.lead.auth(
      api().patch(`/api/v1/projects/${world.project.id}/status`).send({ status: 'ACTIVE' }),
    );
    // Next week, Monday to Friday: 20 hours spread over five working days.
    const monday = addDaysTo(mondayOf(today('Asia/Kolkata')), 7);
    await createTask(world, {
      startDate: monday,
      dueDate: addDaysTo(monday, 4),
      estimatedHours: 20,
    });

    const report = await world.sessions.admin.auth(
      api().get('/api/v1/reports/capacity').query({ from: monday, weeks: 2 }),
    );
    expect(report.status).toBe(200);
    expect(report.body.from).toBe(monday);

    const row = report.body.rows.find(
      (entry: { user: { id: string } }) => entry.user.id === world.member.id,
    );
    expect(row.weeks[0]).toMatchObject({ capacityHours: 40, plannedHours: 20, utilisation: 50 });
    expect(row.weeks[1]).toMatchObject({ plannedHours: 0, utilisation: 0 });
    expect(row.projects).toBe(1);
  });

  it('removes approved leave from capacity', async () => {
    const world = await seedProjectWorld();
    const monday = addDaysTo(mondayOf(today('Asia/Kolkata')), 14);
    const request = await world.sessions.member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'ANNUAL', startDate: monday, endDate: addDaysTo(monday, 1) }),
    );
    await world.sessions.admin.auth(
      api().post(`/api/v1/leave/${request.body.id}/decide`).send({ approve: true }),
    );

    const report = await world.sessions.admin.auth(
      api().get('/api/v1/reports/capacity').query({ from: monday, weeks: 1 }),
    );
    const row = report.body.rows.find(
      (entry: { user: { id: string } }) => entry.user.id === world.member.id,
    );
    expect(row.weeks[0]).toMatchObject({ leaveDays: 2, capacityHours: 24 });
  });

  it('limits a lead to the people on their projects and refuses members', async () => {
    const world = await seedProjectWorld();
    const lead = await world.sessions.lead.auth(api().get('/api/v1/reports/capacity'));
    const ids = lead.body.rows.map((row: { user: { id: string } }) => row.user.id);
    expect(ids).toContain(world.member.id);
    expect(ids).not.toContain(world.outsider.id);

    const member = await world.sessions.member.auth(api().get('/api/v1/reports/capacity'));
    expect(member.status).toBe(403);
  });
});

describe('calendar', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('gathers deadlines, milestones, phases, leave and holidays the caller may see', async () => {
    const world = await seedProjectWorld();
    await createTask(world, { name: 'Calibrate sensors', dueDate: '2026-09-12' });
    await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/milestones`)
        .send({ name: 'Prototype ready', date: '2026-09-20' }),
    );
    await world.sessions.admin.auth(
      api().post('/api/v1/organization/holidays').send({ date: '2026-09-15', name: 'Festival' }),
    );

    const member = await world.sessions.member.auth(
      api().get('/api/v1/calendar').query({ from: '2026-09-01', to: '2026-09-30' }),
    );
    expect(member.status).toBe(200);
    const kinds = new Set(member.body.data.map((event: { kind: string }) => event.kind));
    expect(kinds).toEqual(new Set(['TASK_DUE', 'MILESTONE', 'HOLIDAY']));

    const outsider = await world.sessions.outsider.auth(
      api().get('/api/v1/calendar').query({ from: '2026-09-01', to: '2026-09-30' }),
    );
    expect(outsider.body.data.map((event: { kind: string }) => event.kind)).toEqual(['HOLIDAY']);

    const foreign = await world.sessions.outsider.auth(
      api()
        .get('/api/v1/calendar')
        .query({ from: '2026-09-01', to: '2026-09-30', projectId: world.project.id }),
    );
    expect(foreign.status).toBe(404);
  });

  it('refuses an unbounded range', async () => {
    const world = await seedProjectWorld();
    const response = await world.sessions.member.auth(
      api().get('/api/v1/calendar').query({ from: '2026-01-01', to: '2026-12-31' }),
    );
    expect(response.status).toBe(400);
  });
});

describe('exports', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('downloads the task register as CSV with formulas defused', async () => {
    const world = await seedProjectWorld();
    await createTask(world, { name: '=HYPERLINK("http://evil")' });

    const response = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/export/tasks`),
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('EKV-01-tasks-');
    expect(response.text).toContain('Reference,WBS,Task');
    expect(response.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('follows the report:export permission', async () => {
    const world = await seedProjectWorld();
    const member = await world.sessions.member.auth(
      api().get(`/api/v1/projects/${world.project.id}/export/risks`),
    );
    expect(member.status).toBe(403);
    const viewer = await world.sessions.viewer.auth(
      api().get(`/api/v1/projects/${world.project.id}/export/risks`),
    );
    expect(viewer.status).toBe(200);
    const outsider = await world.sessions.outsider.auth(
      api().get(`/api/v1/projects/${world.project.id}/export/risks`),
    );
    expect(outsider.status).toBe(404);
    const unknown = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/export/passwords`),
    );
    expect(unknown.status).toBe(400);
  });

  it('exports workload and attendance only for people the caller may see', async () => {
    const world = await seedProjectWorld();
    await createTask(world);
    const workload = await world.sessions.lead.auth(api().get('/api/v1/reports/workload.csv'));
    expect(workload.status).toBe(200);
    expect(workload.text).toContain('Mira Member');

    await world.sessions.member.auth(api().post('/api/v1/attendance/start-work').send({}));
    await world.sessions.outsider.auth(api().post('/api/v1/attendance/start-work').send({}));
    const range = {
      from: addDaysTo(today('Asia/Kolkata'), -1),
      to: addDaysTo(today('Asia/Kolkata'), 1),
    };

    const lead = await world.sessions.lead.auth(
      api().get('/api/v1/attendance/export.csv').query(range),
    );
    expect(lead.text).toContain('Mira Member');
    expect(lead.text).not.toContain('Otto Outsider');

    const self = await world.sessions.outsider.auth(
      api().get('/api/v1/attendance/export.csv').query(range),
    );
    expect(self.text).toContain('Otto Outsider');
    expect(self.text).not.toContain('Mira Member');
  });
});

describe('workload report', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('never widens visibility when a project id is named', async () => {
    const world = await seedProjectWorld();
    await createTask(world);
    const response = await world.sessions.outsider.auth(
      api().get('/api/v1/reports/workload').query({ projectId: world.project.id }),
    );
    expect(response.status).toBe(200);
    expect(response.body.rows).toEqual([]);
  });
});
