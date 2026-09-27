/**
 * The security checklist from `docs/TEST_STRATEGY.md` section 4, as executable tests.
 *
 * A checklist nobody runs is a wish. These assert the behaviour directly, so a change that
 * quietly removes a header or widens an object lookup fails the build.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, errorCode } from '../helpers/api.js';
import { closeDatabase, resetDatabase, testDb } from '../helpers/db.js';
import { seedBaseWorld, seedUser, TEST_PASSWORD } from '../helpers/fixtures.js';
import { createTask, seedProjectWorld } from '../helpers/world.js';

describe('transport and headers', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('sets the security headers helmet provides', async () => {
    const response = await api().get('/api/v1/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-dns-prefetch-control']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBeDefined();
    // The framework should not advertise itself.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a request id on every response, including failures', async () => {
    const ok = await api().get('/api/v1/health');
    const failure = await api().get('/api/v1/does-not-exist');

    expect(ok.headers['x-request-id']).toBeTruthy();
    expect(failure.body.requestId).toBeTruthy();
  });

  it('answers an unknown route with a structured error rather than HTML', async () => {
    const response = await api().get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('rejects a malformed JSON body with a clear message', async () => {
    const response = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });
});

describe('what the API never reveals', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('does not leak a stack trace or internal detail on an unexpected failure', async () => {
    // An id of the wrong shape reaches the database layer; whatever happens there, the
    // client must not see it.
    const world = await seedBaseWorld();
    const { signIn } = await import('../helpers/api.js');
    const admin = await signIn(world.admin);

    const response = await admin.auth(api().get('/api/v1/users/' + 'x'.repeat(200)));

    expect(response.status).toBeGreaterThanOrEqual(400);
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('prisma');
    expect(serialised).not.toContain('at Object.');
    expect(serialised).not.toContain('node_modules');
  });

  it('does not confirm whether an email address has an account', async () => {
    const world = await seedBaseWorld();

    const known = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: world.member.email });
    const unknown = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'definitely-nobody@ekavist.test' });

    expect(known.status).toBe(unknown.status);
    expect(JSON.stringify(known.body)).toBe(JSON.stringify(unknown.body));
  });

  it('does not reveal that a project exists to someone who cannot see it', async () => {
    const world = await seedProjectWorld();

    const real = await world.sessions.outsider.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );
    const imaginary = await world.sessions.outsider.auth(
      api().get('/api/v1/projects/clzzzzzzzzzzzzzzzzzzzzzzz'),
    );

    // Identical answers: the id being real is not observable.
    expect(real.status).toBe(imaginary.status);
    expect(real.status).toBe(404);
  });
});

describe('object-level access (IDOR)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses a task id that belongs to another project', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const second = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Second project',
        code: 'SECOND-1',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-12-01',
      }),
    );

    // The task exists and the caller leads both projects, but the task is not in this one.
    const response = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${second.body.id}/tasks/${task.id}`),
    );
    expect(response.status).toBe(404);
  });

  it('refuses a phase id from another project', async () => {
    const world = await seedProjectWorld();

    const second = await world.sessions.admin.auth(
      api().post('/api/v1/projects').send({
        name: 'Second project',
        code: 'SECOND-2',
        leadId: world.lead.id,
        startDate: '2026-09-01',
        plannedEndDate: '2026-12-01',
      }),
    );

    const response = await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${second.body.id}/phases/${world.phaseIds[0]}`)
        .send({ name: 'Hijacked' }),
    );
    expect(response.status).toBe(404);
  });

  it('refuses to assign a task to somebody who is not on the project', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/tasks`)
        .send({ name: 'Sneaky', assigneeIds: [world.outsider.id] }),
    );

    expect(response.status).toBe(400);
  });

  it('refuses a notification that belongs to another person', async () => {
    const world = await seedProjectWorld();

    // Assigning a task notifies the member.
    await createTask(world);
    const memberNotifications = await world.sessions.member.auth(
      api().get('/api/v1/notifications'),
    );
    const notificationId = memberNotifications.body.data[0]?.id;
    expect(notificationId).toBeTruthy();

    // Another person marking it read must have no effect on it.
    await world.sessions.otherMember.auth(
      api().post(`/api/v1/notifications/${notificationId}/read`),
    );

    const row = await testDb().notification.findUniqueOrThrow({
      where: { id: notificationId },
      select: { readAt: true },
    });
    expect(row.readAt).toBeNull();
  });
});

describe('input handling', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('stores a SQL-shaped string as text rather than executing it', async () => {
    const world = await seedProjectWorld();
    const hostile = 'Robert\'); DROP TABLE "Task"; --';

    const created = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/tasks`).send({ name: hostile }),
    );
    expect(created.status).toBe(201);
    expect(created.body.name).toBe(hostile);

    // The table is still there, and the search path handles the same string safely.
    const search = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/tasks`).query({ search: hostile }),
    );
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
  });

  it('keeps script-shaped text as data through the chat search path', async () => {
    const world = await seedProjectWorld();
    const hostile = '<script>alert("x")</script>';

    await world.sessions.member.auth(
      api().post(`/api/v1/projects/${world.project.id}/messages`).send({ body: hostile }),
    );

    const response = await world.sessions.member.auth(
      api().get(`/api/v1/projects/${world.project.id}/messages`).query({ search: 'script' }),
    );

    expect(response.status).toBe(200);
    // Stored and returned verbatim; escaping is the renderer's job, and React does it.
    expect(response.body.data[0].body).toBe(hostile);
  });

  it('refuses an oversized page size instead of honouring it', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/tasks`).query({ pageSize: 100000 }),
    );

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });

  it('refuses to sort by a column that is not on the allow-list', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api()
        .get(`/api/v1/projects/${world.project.id}/tasks`)
        .query({ sort: 'project.organizationId' }),
    );

    expect(response.status).toBe(400);
  });

  it('refuses a link that is not http or https', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/documents`)
        .send({ name: 'Bad', url: 'javascript:alert(1)' }),
    );

    expect(response.status).toBe(400);
  });
});

describe('session security', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('locks an account after repeated failures and still refuses the right password', async () => {
    const world = await seedBaseWorld();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await api()
        .post('/api/v1/auth/login')
        .send({ email: world.member.email, password: `wrong-${attempt}` });
    }

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: world.member.email, password: TEST_PASSWORD });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACCOUNT_DISABLED');
  });

  it('does not accept an access token signed by somebody else', async () => {
    const response = await api()
      .get('/api/v1/auth/me')
      .set(
        'Authorization',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbnlvbmUifQ.not-a-real-signature',
      );

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('TOKEN_INVALID');
  });

  it('stops honouring the token of a user who has been deactivated', async () => {
    const world = await seedBaseWorld();
    const { signIn } = await import('../helpers/api.js');
    const victim = await seedUser(world.org.id);
    const session = await signIn(victim);

    await testDb().user.update({ where: { id: victim.id }, data: { status: 'INACTIVE' } });

    const response = await session.auth(api().get('/api/v1/auth/me'));
    expect(response.status).toBe(403);
  });
});
