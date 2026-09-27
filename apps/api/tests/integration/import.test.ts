import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, errorCode } from '../helpers/api.js';
import { closeDatabase, resetDatabase, testDb } from '../helpers/db.js';
import { seedProjectWorld, type ProjectWorld } from '../helpers/world.js';

/** Builds a workbook in memory that looks like a real project tracker. */
async function workbook(
  rows: (string | number | null)[][],
  headers = [
    'WBS',
    'Task',
    'Owner Email',
    'Start Date',
    'End Date',
    'Status',
    'Progress',
    'Predecessor',
  ],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Plan');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function upload(world: ProjectWorld, buffer: Buffer, mapping?: unknown) {
  const request = world.sessions.lead
    .auth(api().post(`/api/v1/projects/${world.project.id}/import`))
    .attach('file', buffer, 'tracker.xlsx');

  if (mapping != null) void request.field('mapping', JSON.stringify(mapping));
  return request;
}

describe('excel import', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('parses a tracker and previews it without writing anything', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      [
        '1',
        'Requirements',
        'member@ekavist.test',
        '2026-09-01',
        '2026-09-10',
        'Completed',
        100,
        null,
      ],
      [
        '1.1',
        'Interviews',
        'member@ekavist.test',
        '2026-09-01',
        '2026-09-05',
        'Completed',
        100,
        null,
      ],
      [
        '1.2',
        'Write the spec',
        'omar@ekavist.test',
        '2026-09-06',
        '2026-09-10',
        'In Progress',
        40,
        'Interviews',
      ],
    ]);

    const response = await upload(world, file);

    expect(response.status).toBe(201);
    expect(response.body.canConfirm).toBe(true);
    expect(response.body.summary.tasksToCreate).toBeGreaterThan(0);
    expect(response.body.rows).toHaveLength(3);

    // Nothing reaches the project until the import is confirmed.
    const tasks = await testDb().task.count({ where: { projectId: world.project.id } });
    expect(tasks).toBe(0);
  });

  it('recognises common column headings without being told', async () => {
    const world = await seedProjectWorld();
    const file = await workbook(
      [['1', 'Kickoff', 'member@ekavist.test', '2026-09-01', '2026-09-02', 'Done', 100, null]],
      [
        'WBS ID',
        'Activity',
        'Email',
        'Planned Start',
        'Target Date',
        'Status',
        '% Complete',
        'Depends On',
      ],
    );

    const response = await upload(world, file);
    expect(response.status).toBe(201);
    expect(response.body.rows[0].taskName).toBe('Kickoff');
    expect(response.body.rows[0].ownerEmail).toBe('member@ekavist.test');
    expect(response.body.rows[0].status).toBe('COMPLETED');
  });

  it('refuses a row with no task name', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      ['1', 'Real task', 'member@ekavist.test', '2026-09-01', '2026-09-02', 'Done', 100, null],
      [null, null, 'member@ekavist.test', '2026-09-03', '2026-09-04', 'Done', 100, null],
    ]);

    const response = await upload(world, file);
    expect(response.body.canConfirm).toBe(false);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_TASK_NAME', severity: 'ERROR' }),
    );
  });

  it('refuses a date it cannot read', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      [
        '1',
        'Broken dates',
        'member@ekavist.test',
        'sometime next week',
        '2026-09-02',
        'Done',
        100,
        null,
      ],
    ]);

    const response = await upload(world, file);
    expect(response.body.canConfirm).toBe(false);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({ code: 'BAD_DATE', severity: 'ERROR' }),
    );
  });

  it('refuses a due date before the start date', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      [
        '1',
        'Backwards',
        'member@ekavist.test',
        '2026-09-10',
        '2026-09-01',
        'In Progress',
        10,
        null,
      ],
    ]);

    const response = await upload(world, file);
    expect(response.body.canConfirm).toBe(false);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({ code: 'DATES_REVERSED', severity: 'ERROR' }),
    );
  });

  it('refuses a circular dependency chain', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      ['1', 'A', 'member@ekavist.test', '2026-09-01', '2026-09-02', 'In Progress', 0, 'C'],
      ['2', 'B', 'member@ekavist.test', '2026-09-03', '2026-09-04', 'In Progress', 0, 'A'],
      ['3', 'C', 'member@ekavist.test', '2026-09-05', '2026-09-06', 'In Progress', 0, 'B'],
    ]);

    const response = await upload(world, file);
    expect(response.body.canConfirm).toBe(false);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({ code: 'DEPENDENCY_CYCLE', severity: 'ERROR' }),
    );
  });

  it('warns about an unknown owner rather than silently dropping them', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      ['1', 'Orphan', 'nobody@ekavist.test', '2026-09-01', '2026-09-02', 'In Progress', 0, null],
    ]);

    const response = await upload(world, file);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_USER', severity: 'ERROR' }),
    );
    expect(response.body.summary.unknownUsers).toContain('nobody@ekavist.test');
  });

  it('imports the plan when the preview is confirmed', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      [
        '1',
        'Requirements',
        'member@ekavist.test',
        '2026-09-01',
        '2026-09-10',
        'Completed',
        100,
        null,
      ],
      [
        '1.1',
        'Interviews',
        'member@ekavist.test',
        '2026-09-01',
        '2026-09-05',
        'Completed',
        100,
        null,
      ],
      [
        '1.2',
        'Write the spec',
        'omar@ekavist.test',
        '2026-09-06',
        '2026-09-10',
        'In Progress',
        40,
        'Interviews',
      ],
    ]);

    const preview = await upload(world, file);
    expect(preview.body.canConfirm).toBe(true);

    const confirmed = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/import/${preview.body.jobId}/confirm`)
        .send({ checksum: preview.body.checksum }),
    );

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.tasksCreated).toBeGreaterThan(0);
    expect(confirmed.body.wbsCreated).toBeGreaterThan(0);

    const db = testDb();
    const tasks = await db.task.findMany({
      where: { projectId: world.project.id },
      select: { name: true, status: true, progress: true, reference: true },
    });
    expect(tasks.length).toBe(confirmed.body.tasksCreated);
    expect(tasks.every((task) => task.reference.startsWith('T-'))).toBe(true);

    // The WBS is renumbered into real dotted codes.
    const wbs = await db.wbsItem.findMany({
      where: { projectId: world.project.id },
      select: { code: true },
    });
    expect(wbs.map((item) => item.code)).toContain('1.0');

    // A dependency named in the sheet becomes a real edge.
    const dependencies = await db.taskDependency.count({
      where: { projectId: world.project.id },
    });
    expect(dependencies).toBe(confirmed.body.dependenciesCreated);
  });

  it('refuses to confirm the same import twice', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      ['1', 'Only task', 'member@ekavist.test', '2026-09-01', '2026-09-02', 'Done', 100, null],
    ]);

    const preview = await upload(world, file);
    const body = { checksum: preview.body.checksum };

    const first = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/import/${preview.body.jobId}/confirm`)
        .send(body),
    );
    const second = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/import/${preview.body.jobId}/confirm`)
        .send(body),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(422);
    expect(errorCode(second.body)).toBe('IMPORT_JOB_NOT_PENDING');
  });

  it('refuses a confirmation whose checksum does not match the preview', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      ['1', 'Only task', 'member@ekavist.test', '2026-09-01', '2026-09-02', 'Done', 100, null],
    ]);

    const preview = await upload(world, file);
    const response = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/import/${preview.body.jobId}/confirm`)
        .send({ checksum: 'a-stale-checksum' }),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('IMPORT_JOB_NOT_PENDING');
  });

  it('does not let a team member run an import', async () => {
    const world = await seedProjectWorld();
    const file = await workbook([
      ['1', 'Task', 'member@ekavist.test', '2026-09-01', '2026-09-02', 'Done', 100, null],
    ]);

    const response = await world.sessions.member
      .auth(api().post(`/api/v1/projects/${world.project.id}/import`))
      .attach('file', file, 'tracker.xlsx');

    expect(response.status).toBe(403);
  });

  it('rejects a file that is not a spreadsheet', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead
      .auth(api().post(`/api/v1/projects/${world.project.id}/import`))
      .attach('file', Buffer.from('not a workbook'), 'notes.txt');

    expect(response.status).toBe(400);
  });
});
