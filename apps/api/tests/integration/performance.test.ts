/**
 * Phase 19: the two behaviours that changed when the resource library and the derived
 * progress cache were made to hold up at size.
 *
 * The resource library now pages in the database across three tables, so the things worth
 * asserting are the ones an in-memory merge got right by accident: that the ordering is
 * global rather than per-source, that page two does not repeat page one, that the total
 * counts everything rather than what one page happened to contain, and that the filters
 * still reach every source.
 *
 * The consistency job is asserted the only way that means anything: by writing a wrong
 * number straight into the database, the way a manual correction or a restored backup
 * would, and requiring the job to find it, fix it and say so.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runConsistencyScan } from '../../src/jobs/consistency.job.js';
import { api } from '../helpers/api.js';
import { closeDatabase, resetDatabase, testDb } from '../helpers/db.js';
import { createTask, seedProjectWorld, type ProjectWorld } from '../helpers/world.js';

/** Puts one resource of each source into the project, oldest first. */
async function seedResources(world: ProjectWorld): Promise<void> {
  const task = await createTask(world);

  const document = await world.sessions.lead.auth(
    api().post(`/api/v1/projects/${world.project.id}/documents`).send({
      name: 'Alpha specification',
      url: 'https://example.com/alpha.pdf',
      category: 'REQUIREMENTS',
    }),
  );
  const attachment = await world.sessions.lead.auth(
    api()
      .post(`/api/v1/projects/${world.project.id}/tasks/${task.id}/attachments`)
      .send({ name: 'Bravo wiring diagram', url: 'https://example.com/bravo.png' }),
  );
  const message = await world.sessions.member.auth(
    api()
      .post(`/api/v1/projects/${world.project.id}/messages`)
      .send({
        body: 'Here is the datasheet.',
        links: [{ url: 'https://example.com/charlie.pdf', name: 'Charlie datasheet' }],
      }),
  );

  // A fixture that half-failed would make the assertions below meaningless.
  for (const [what, response] of [
    ['document', document],
    ['task attachment', attachment],
    ['message', message],
  ] as const) {
    if (response.status !== 201) {
      throw new Error(`Could not create the ${what}: ${JSON.stringify(response.body)}`);
    }
  }
}

interface ResourceRow {
  id: string;
  name: string;
  source: 'MESSAGE' | 'TASK' | 'DOCUMENT';
  createdAt: string;
}

describe('the project resource library pages in the database', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('orders every source together and reports the real total', async () => {
    const world = await seedProjectWorld();
    await seedResources(world);

    const response = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/resources`),
    );

    expect(response.status).toBe(200);
    const rows = response.body.data as ResourceRow[];

    expect(response.body.meta.total).toBe(3);
    expect(rows.map((row) => row.source)).toEqual(['MESSAGE', 'TASK', 'DOCUMENT']);
    expect(rows.map((row) => row.name)).toEqual([
      'Charlie datasheet',
      'Bravo wiring diagram',
      'Alpha specification',
    ]);
  });

  it('does not repeat a row across pages, and counts past the page', async () => {
    const world = await seedProjectWorld();
    await seedResources(world);

    const first = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/resources?page=1&pageSize=2`),
    );
    const second = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/resources?page=2&pageSize=2`),
    );

    const firstIds = (first.body.data as ResourceRow[]).map((row) => row.id);
    const secondIds = (second.body.data as ResourceRow[]).map((row) => row.id);

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(1);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);

    // The total is the library, not the page.
    expect(first.body.meta.total).toBe(3);
    expect(second.body.meta.total).toBe(3);
  });

  it('searches by name across all three sources', async () => {
    const world = await seedProjectWorld();
    await seedResources(world);

    const cases = [
      ['alpha', 'DOCUMENT'],
      ['bravo', 'TASK'],
      ['charlie', 'MESSAGE'],
    ] as const;

    for (const [term, expected] of cases) {
      const response = await world.sessions.lead.auth(
        api().get(`/api/v1/projects/${world.project.id}/resources?search=${term}`),
      );
      const rows = response.body.data as ResourceRow[];

      expect(response.body.meta.total).toBe(1);
      expect(rows[0]?.source).toBe(expected);
    }
  });

  it('returns only pinned chat material when asked for it', async () => {
    const world = await seedProjectWorld();
    await seedResources(world);

    const unpinned = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/resources?pinnedOnly=true`),
    );
    expect(unpinned.body.meta.total).toBe(0);

    const messages = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/messages`),
    );
    const messageId = (messages.body.data as { id: string }[])[0]?.id as string;
    await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/messages/${messageId}/pin`).send({}),
    );

    const pinned = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/resources?pinnedOnly=true`),
    );
    const rows = pinned.body.data as ResourceRow[];

    expect(pinned.body.meta.total).toBe(1);
    expect(rows[0]?.source).toBe('MESSAGE');
    expect(rows[0]?.name).toBe('Charlie datasheet');
  });

  it('keeps one project out of the library of another', async () => {
    const world = await seedProjectWorld();
    await seedResources(world);

    const other = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Second Project',
        code: 'EKV-02',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-11-30',
      }),
    );

    const response = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${other.body.id}/resources`),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(0);
  });
});

describe('the derived-progress consistency job', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('reports nothing when the cache already agrees with the tasks', async () => {
    const world = await seedProjectWorld();
    await createTask(world);

    const stats = await runConsistencyScan(testDb(), world.org.id);

    expect(stats.projectsExamined).toBe(1);
    expect(stats.projectsWithDrift).toBe(0);
    expect(stats.rowsCorrected).toBe(0);
    expect(stats.drift).toEqual([]);
  });

  it('finds and corrects progress written straight into the database', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const completed = await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'COMPLETED' }),
    );
    expect(completed.status).toBe(200);

    const db = testDb();
    const phaseId = world.phaseIds[1] as string;

    // Exactly the shape of the gap D-006 recorded: writes that never went through the
    // service, so the cache was never refreshed.
    await db.project.update({ where: { id: world.project.id }, data: { progress: 3 } });
    await db.phase.update({ where: { id: phaseId }, data: { progress: 7 } });

    const stats = await runConsistencyScan(db, world.org.id);

    expect(stats.projectsWithDrift).toBe(1);
    expect(stats.rowsCorrected).toBe(2);
    expect(stats.drift).toContainEqual(
      expect.objectContaining({ entity: 'PROJECT', was: 3, projectCode: 'EKV-01' }),
    );
    expect(stats.drift).toContainEqual(expect.objectContaining({ entity: 'PHASE', was: 7 }));

    const project = await db.project.findUniqueOrThrow({ where: { id: world.project.id } });
    const phase = await db.phase.findUniqueOrThrow({ where: { id: phaseId } });
    expect(project.progress).not.toBe(3);
    expect(phase.progress).toBe(100);

    // And the second run has nothing left to do, which is what makes it safe nightly.
    const again = await runConsistencyScan(db, world.org.id);
    expect(again.projectsWithDrift).toBe(0);
  });

  it('leaves a deleted project alone', async () => {
    const world = await seedProjectWorld();
    await world.sessions.admin.auth(api().delete(`/api/v1/projects/${world.project.id}`));

    const stats = await runConsistencyScan(testDb(), world.org.id);

    expect(stats.projectsExamined).toBe(0);
  });
});
