/**
 * The permission matrix (docs/PERMISSIONS.md section 7).
 *
 * Every project endpoint is exercised by every role, and the expected status code is
 * asserted — not merely the absence of data. A route that answers `200 []` where it should
 * answer `403` still fails here, which is the point: hiding a button in the UI is not a
 * control, and this suite is what proves the server enforces the rules on its own.
 *
 * Isolation matters as much as coverage. Every case that changes something creates its own
 * target first, so one case can never leave state that makes the next one pass or fail for
 * the wrong reason. The shared world is rebuilt once and only read from.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../helpers/api.js';
import { closeDatabase, resetDatabase, testDb } from '../helpers/db.js';
import { seedUser } from '../helpers/fixtures.js';
import { createTask, seedProjectWorld, type ProjectWorld } from '../helpers/world.js';

type RoleName = 'admin' | 'lead' | 'member' | 'viewer' | 'outsider';

const ROLES: RoleName[] = ['admin', 'lead', 'member', 'viewer', 'outsider'];

/** Everything a case may need, created fresh for the role that is about to be tested. */
interface Fixture {
  taskId: string;
  secondTaskId: string;
  phaseId: string;
  /** Someone not yet on the project, safe to add. */
  newcomerId: string;
  /** Someone already on the project, safe to remove. */
  removableId: string;
}

interface Case {
  name: string;
  method: 'get' | 'post' | 'patch' | 'delete' | 'put';
  path: (world: ProjectWorld, fixture: Fixture) => string;
  body?: (world: ProjectWorld, fixture: Fixture) => unknown;
  allowed: RoleName[];
  /** Status a permitted caller should receive; defaults to "any 2xx". */
  okStatus?: number;
  /** True when the case changes data and therefore needs its own targets. */
  mutates?: boolean;
}

const CASES: Case[] = [
  // --- reading -----------------------------------------------------------
  {
    name: 'read the project',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}`,
    allowed: ['admin', 'lead', 'member', 'viewer'],
  },
  {
    name: 'read the project dashboard',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}/dashboard`,
    allowed: ['admin', 'lead', 'member', 'viewer'],
  },
  {
    name: 'list tasks',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}/tasks`,
    allowed: ['admin', 'lead', 'member', 'viewer'],
  },
  {
    name: 'read the Gantt',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}/gantt`,
    allowed: ['admin', 'lead', 'member', 'viewer'],
  },
  {
    name: 'read project notes',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}/notes`,
    allowed: ['admin', 'lead', 'member', 'viewer'],
  },
  {
    name: 'read the weekly report',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}/reports/weekly`,
    allowed: ['admin', 'lead', 'member', 'viewer'],
  },
  {
    name: 'read the chat',
    method: 'get',
    path: (world) => `/api/v1/projects/${world.project.id}/messages`,
    // A viewer only reads the chat when their membership opts in, which this one does not.
    allowed: ['admin', 'lead', 'member'],
  },

  // --- project management ------------------------------------------------
  {
    name: 'update the project',
    method: 'patch',
    path: (world) => `/api/v1/projects/${world.project.id}`,
    body: () => ({ priority: 'HIGH' }),
    allowed: ['admin', 'lead'],
    mutates: true,
  },
  {
    name: 'add a member',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/members`,
    body: (_world, fixture) => ({ userId: fixture.newcomerId }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'remove a member',
    method: 'delete',
    path: (world, fixture) => `/api/v1/projects/${world.project.id}/members/${fixture.removableId}`,
    allowed: ['admin', 'lead'],
    mutates: true,
  },

  // --- waterfall ----------------------------------------------------------
  {
    name: 'create a phase',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/phases`,
    body: () => ({ name: `Phase ${Math.random().toString(36).slice(2, 8)}` }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'update a phase',
    method: 'patch',
    path: (world, fixture) => `/api/v1/projects/${world.project.id}/phases/${fixture.phaseId}`,
    body: () => ({ description: 'Touched by the permission suite' }),
    allowed: ['admin', 'lead'],
    mutates: true,
  },

  // --- work breakdown ------------------------------------------------------
  {
    name: 'create a WBS item',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/wbs`,
    body: () => ({ name: 'A WBS item' }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },

  // --- tasks ---------------------------------------------------------------
  {
    name: 'create a task',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/tasks`,
    body: () => ({ name: 'A new task' }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'edit a task',
    method: 'patch',
    path: (world, fixture) => `/api/v1/projects/${world.project.id}/tasks/${fixture.taskId}`,
    body: () => ({ name: 'Renamed task' }),
    allowed: ['admin', 'lead'],
    mutates: true,
  },
  {
    name: 'delete a task',
    method: 'delete',
    path: (world, fixture) => `/api/v1/projects/${world.project.id}/tasks/${fixture.taskId}`,
    allowed: ['admin', 'lead'],
    okStatus: 204,
    mutates: true,
  },
  {
    name: 'comment on a task',
    method: 'post',
    path: (world, fixture) =>
      `/api/v1/projects/${world.project.id}/tasks/${fixture.taskId}/comments`,
    body: () => ({ body: 'A comment' }),
    allowed: ['admin', 'lead', 'member'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'create a dependency',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/dependencies`,
    body: (_world, fixture) => ({
      predecessorId: fixture.taskId,
      successorId: fixture.secondTaskId,
    }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },

  // --- chat ----------------------------------------------------------------
  {
    name: 'post a message',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/messages`,
    body: () => ({ body: 'Hello' }),
    allowed: ['admin', 'lead', 'member'],
    okStatus: 201,
    mutates: true,
  },

  // --- documents and notes --------------------------------------------------
  {
    name: 'add a document',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/documents`,
    body: () => ({ name: 'Spec', url: 'https://example.com/spec' }),
    allowed: ['admin', 'lead', 'member'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'write a project note',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/notes`,
    body: () => ({ title: 'A note' }),
    allowed: ['admin', 'lead', 'member'],
    okStatus: 201,
    mutates: true,
  },

  // --- governance ------------------------------------------------------------
  {
    name: 'raise a risk',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/risks`,
    body: () => ({ title: 'A risk', probability: 'MEDIUM', impact: 'HIGH' }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'raise an issue',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/issues`,
    body: () => ({ title: 'An issue' }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'raise a change request',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/change-requests`,
    body: () => ({ title: 'A change' }),
    allowed: ['admin', 'lead', 'member'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'record a decision',
    method: 'post',
    path: (world) => `/api/v1/projects/${world.project.id}/decisions`,
    body: (world) => ({
      title: 'A decision',
      decidedOn: '2026-09-15',
      decisionMakerId: world.lead.id,
    }),
    allowed: ['admin', 'lead'],
    okStatus: 201,
    mutates: true,
  },
  {
    name: 'replace the RACI matrix',
    method: 'put',
    path: (world) => `/api/v1/projects/${world.project.id}/raci`,
    body: () => ({ entries: [] }),
    allowed: ['admin', 'lead'],
    mutates: true,
  },
];

describe('project permission matrix', () => {
  let world: ProjectWorld;

  beforeAll(async () => {
    await resetDatabase();
    world = await seedProjectWorld();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  /**
   * Builds the targets a case needs. Created directly rather than through the API so that
   * setting up a test for one role never depends on another role's permissions.
   */
  async function makeFixture(): Promise<Fixture> {
    const db = testDb();

    const [first, second] = await Promise.all([createTask(world), createTask(world)]);

    const newcomer = await seedUser(world.org.id, { role: 'TEAM_MEMBER' });
    const removable = await seedUser(world.org.id, { role: 'TEAM_MEMBER' });
    await db.projectMember.create({
      data: { projectId: world.project.id, userId: removable.id, projectRole: 'MEMBER' },
    });

    // `(projectId, sequence)` is unique, so the next free number is read rather than
    // guessed — a random one collides once enough fixtures have been created.
    const highest = await db.phase.aggregate({
      where: { projectId: world.project.id },
      _max: { sequence: true },
    });

    const phase = await db.phase.create({
      data: {
        projectId: world.project.id,
        name: `Scratch ${Math.random().toString(36).slice(2, 8)}`,
        sequence: (highest._max.sequence ?? 0) + 1,
      },
      select: { id: true },
    });

    return {
      taskId: first.id,
      secondTaskId: second.id,
      phaseId: phase.id,
      newcomerId: newcomer.id,
      removableId: removable.id,
    };
  }

  for (const testCase of CASES) {
    for (const role of ROLES) {
      const permitted = testCase.allowed.includes(role);

      it(`${role} ${permitted ? 'may' : 'may not'} ${testCase.name}`, async () => {
        const fixture = await makeFixture();
        const session = world.sessions[role];
        const path = testCase.path(world, fixture);
        const body = testCase.body?.(world, fixture);

        let request = session.auth(api()[testCase.method](path));
        if (body !== undefined) request = request.send(body as object);

        const response = await request;

        if (permitted) {
          if (testCase.okStatus != null) {
            expect(response.status).toBe(testCase.okStatus);
          } else {
            expect(response.status).toBeGreaterThanOrEqual(200);
            expect(response.status).toBeLessThan(300);
          }
          return;
        }

        // An outsider receives 404, so the API never confirms the project exists.
        // Anyone who can see the project but lacks the permission receives 403.
        expect(response.status).toBe(role === 'outsider' ? 404 : 403);
      });
    }
  }
});

describe('organisation permission matrix', () => {
  let world: ProjectWorld;

  beforeAll(async () => {
    await resetDatabase();
    world = await seedProjectWorld();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const orgCases: {
    name: string;
    call: (world: ProjectWorld, role: RoleName) => Promise<{ status: number }>;
    allowed: RoleName[];
  }[] = [
    {
      name: 'list people',
      allowed: ['admin', 'lead', 'member', 'outsider'],
      call: (w, role) => w.sessions[role].auth(api().get('/api/v1/users')),
    },
    {
      name: 'create a person',
      allowed: ['admin'],
      call: (w, role) =>
        w.sessions[role].auth(api().post('/api/v1/users')).send({
          fullName: `New ${role}`,
          email: `new-${role}-${Math.random().toString(36).slice(2, 8)}@ekavist.test`,
        }),
    },
    {
      name: 'create a project',
      allowed: ['admin'],
      call: (w, role) =>
        w.sessions[role].auth(api().post('/api/v1/projects')).send({
          name: `Project by ${role}`,
          code: `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          leadId: w.lead.id,
          startDate: '2026-09-01',
          plannedEndDate: '2026-12-01',
        }),
    },
    {
      name: 'read the audit log',
      allowed: ['admin'],
      call: (w, role) => w.sessions[role].auth(api().get('/api/v1/audit')),
    },
    {
      name: 'read the company dashboard',
      allowed: ['admin'],
      call: (w, role) => w.sessions[role].auth(api().get('/api/v1/dashboard/company')),
    },
    {
      name: 'read notification rules',
      allowed: ['admin'],
      call: (w, role) => w.sessions[role].auth(api().get('/api/v1/notifications/rules')),
    },
  ];

  for (const testCase of orgCases) {
    for (const role of ROLES) {
      const permitted = testCase.allowed.includes(role);

      it(`${role} ${permitted ? 'may' : 'may not'} ${testCase.name}`, async () => {
        const response = await testCase.call(world, role);

        if (permitted) {
          expect(response.status).toBeGreaterThanOrEqual(200);
          expect(response.status).toBeLessThan(300);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }
});

describe('private data stays private', () => {
  let world: ProjectWorld;

  beforeAll(async () => {
    await resetDatabase();
    world = await seedProjectWorld();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('never returns one person’s personal notes to another', async () => {
    const created = await world.sessions.member.auth(
      api().post('/api/v1/me/notes').send({ title: 'My private thought', body: 'Secret' }),
    );
    expect(created.status).toBe(201);

    const leadNotes = await world.sessions.lead.auth(api().get('/api/v1/me/notes'));
    expect(JSON.stringify(leadNotes.body)).not.toContain('My private thought');

    // The project note list is a different table entirely; it cannot reach personal notes.
    const projectNotes = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/notes`),
    );
    expect(JSON.stringify(projectNotes.body)).not.toContain('My private thought');

    const byId = await world.sessions.lead.auth(
      api().patch(`/api/v1/me/notes/${created.body.id}`).send({ title: 'Hijacked' }),
    );
    expect(byId.status).toBe(404);
  });

  it('never exposes a password hash through any user endpoint', async () => {
    const list = await world.sessions.admin.auth(api().get('/api/v1/users'));
    const me = await world.sessions.admin.auth(api().get('/api/v1/auth/me'));
    const one = await world.sessions.admin.auth(api().get(`/api/v1/users/${world.member.id}`));

    for (const response of [list, me, one]) {
      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('passwordHash');
      expect(serialised).not.toContain('argon2');
    }
  });

  it('does not let a member read another person’s attendance', async () => {
    const response = await world.sessions.member.auth(
      api().get('/api/v1/attendance/history').query({ userId: world.otherMember.id }),
    );
    expect(response.status).toBe(403);
  });

  it('does not let a member reach another project by id', async () => {
    // A second project the member is not on. Its id is valid but must be invisible.
    const created = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Somebody else’s project',
        code: 'OTHER-1',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-12-01',
      }),
    );
    expect(created.status).toBe(201);

    const response = await world.sessions.member.auth(
      api().get(`/api/v1/projects/${created.body.id}/tasks`),
    );
    expect(response.status).toBe(404);
  });
});
