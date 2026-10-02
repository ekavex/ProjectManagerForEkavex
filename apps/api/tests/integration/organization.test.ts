/**
 * Organisation administration, two-factor sign-in and leave management.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, errorCode, signIn } from '../helpers/api.js';
import { closeDatabase, resetDatabase, testDb } from '../helpers/db.js';
import { seedBaseWorld, TEST_PASSWORD } from '../helpers/fixtures.js';
import { createTask, seedProjectWorld } from '../helpers/world.js';

afterAll(async () => {
  await closeDatabase();
});

describe('organisation settings and holidays', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('lets everyone read the settings and only an administrator change them', async () => {
    const world = await seedBaseWorld();
    const member = await signIn(world.member);
    const admin = await signIn(world.admin);

    const read = await member.auth(api().get('/api/v1/organization'));
    expect(read.status).toBe(200);
    expect(read.body.annualLeaveDays).toBe(18);

    const refused = await member.auth(
      api().patch('/api/v1/organization').send({ annualLeaveDays: 30 }),
    );
    expect(refused.status).toBe(403);

    const changed = await admin.auth(
      api().patch('/api/v1/organization').send({ annualLeaveDays: 21, lateAfter: '10:15' }),
    );
    expect(changed.body).toMatchObject({ annualLeaveDays: 21, lateAfter: '10:15' });

    const invalid = await admin.auth(
      api().patch('/api/v1/organization').send({ halfDayMinutes: 600, fullDayMinutes: 480 }),
    );
    expect(invalid.status).toBe(400);
  });

  it('manages holidays and refuses a duplicate date', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);
    const member = await signIn(world.member);

    const created = await admin.auth(
      api()
        .post('/api/v1/organization/holidays')
        .send({ date: '2030-01-26', name: 'Republic Day' }),
    );
    expect(created.status).toBe(201);

    const duplicate = await admin.auth(
      api().post('/api/v1/organization/holidays').send({ date: '2030-01-26', name: 'Again' }),
    );
    expect(duplicate.status).toBe(409);

    const memberCreate = await member.auth(
      api().post('/api/v1/organization/holidays').send({ date: '2030-08-15', name: 'Nope' }),
    );
    expect(memberCreate.status).toBe(403);

    const listed = await member.auth(
      api().get('/api/v1/organization/holidays').query({ year: 2030 }),
    );
    expect(listed.body.data).toEqual([
      { id: created.body.id, date: '2030-01-26', name: 'Republic Day' },
    ]);

    const removed = await admin.auth(
      api().delete(`/api/v1/organization/holidays/${created.body.id}`),
    );
    expect(removed.status).toBe(204);
  });
});

describe('role permissions', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('lets an administrator change what a role may do, with immediate effect', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);

    const roles = await admin.auth(api().get('/api/v1/organization/roles'));
    expect(roles.status).toBe(200);
    const adminRow = roles.body.data.find((row: { role: string }) => row.role === 'SUPER_ADMIN');
    expect(adminRow.editable).toBe(false);
    expect(adminRow.permissions).toContain('leave:manage');

    const member = await signIn(world.member);
    expect((await member.auth(api().get('/api/v1/audit'))).status).toBe(403);

    const replaced = await admin.auth(
      api()
        .put('/api/v1/organization/roles/TEAM_MEMBER')
        .send({ permissions: ['user:read', 'attendance:read-own', 'audit:read'] }),
    );
    expect(replaced.status).toBe(200);

    // Permissions are loaded per request, so the next call already sees the change.
    expect((await member.auth(api().get('/api/v1/audit'))).status).toBe(200);
  });

  it('refuses to edit the administrator role and hides the editor from others', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);
    const lead = await signIn(world.lead);

    const editAdmin = await admin.auth(
      api().put('/api/v1/organization/roles/SUPER_ADMIN').send({ permissions: [] }),
    );
    expect(editAdmin.status).toBe(403);

    const unknown = await admin.auth(
      api()
        .put('/api/v1/organization/roles/TEAM_MEMBER')
        .send({ permissions: ['made:up'] }),
    );
    expect(unknown.status).toBe(400);

    expect((await lead.auth(api().get('/api/v1/organization/roles'))).status).toBe(403);
  });

  it('keeps every permission for administrators even when their stored rows are stale', async () => {
    const world = await seedBaseWorld();
    await testDb().rolePermission.deleteMany({
      where: { organizationId: world.org.id, role: 'SUPER_ADMIN', permission: 'role:manage' },
    });
    const admin = await signIn(world.admin);
    expect((await admin.auth(api().get('/api/v1/organization/roles'))).status).toBe(200);
  });
});

describe('two-factor sign-in', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('enrols, then requires a code at sign-in, and accepts a recovery code once', async () => {
    const world = await seedBaseWorld();
    const session = await signIn(world.member);

    const enrol = await session.auth(api().post('/api/v1/auth/two-factor/enrol'));
    expect(enrol.status).toBe(200);
    expect(enrol.body.otpauthUrl).toContain('otpauth://totp/');
    const secret = enrol.body.secret as string;

    const wrong = await session.auth(
      api().post('/api/v1/auth/two-factor/confirm').send({ code: '000000' }),
    );
    expect(errorCode(wrong.body)).toBe('TWO_FACTOR_INVALID');

    const confirmed = await session.auth(
      api()
        .post('/api/v1/auth/two-factor/confirm')
        .send({ code: totp(secret) }),
    );
    expect(confirmed.status).toBe(200);
    const recoveryCodes = confirmed.body.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    const status = await session.auth(api().get('/api/v1/auth/two-factor'));
    expect(status.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });

    const login = (code?: string) =>
      api()
        .post('/api/v1/auth/login')
        .send({ email: world.member.email, password: TEST_PASSWORD, ...(code ? { code } : {}) });

    const prompt = await login();
    expect(prompt.status).toBe(401);
    expect(errorCode(prompt.body)).toBe('TWO_FACTOR_REQUIRED');

    expect(errorCode((await login('123456')).body)).toBe('TWO_FACTOR_INVALID');
    expect((await login(totp(secret))).status).toBe(200);

    const recovery = recoveryCodes[0] as string;
    expect((await login(recovery.toUpperCase())).status).toBe(200);
    expect(errorCode((await login(recovery)).body)).toBe('TWO_FACTOR_INVALID');
  });

  it('turns off only with the password and a code, and an admin can reset it', async () => {
    const world = await seedBaseWorld();
    const session = await signIn(world.member);
    const { body } = await session.auth(api().post('/api/v1/auth/two-factor/enrol'));
    await session.auth(
      api()
        .post('/api/v1/auth/two-factor/confirm')
        .send({ code: totp(body.secret) }),
    );

    const badPassword = await session.auth(
      api()
        .post('/api/v1/auth/two-factor/disable')
        .send({ password: 'wrong-password', code: totp(body.secret) }),
    );
    expect(errorCode(badPassword.body)).toBe('PASSWORD_INCORRECT');

    const admin = await signIn(world.admin);
    const users = await admin.auth(api().get(`/api/v1/users/${world.member.id}`));
    expect(users.body.twoFactorEnabled).toBe(true);

    const reset = await admin.auth(api().post(`/api/v1/users/${world.member.id}/two-factor/reset`));
    expect(reset.status).toBe(204);
    // Signing in works with the password alone again.
    await expect(signIn(world.member)).resolves.toBeTruthy();
  });
});

describe('leave', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // 2030-03-04 is a Monday, far enough ahead that "has it started" never flips mid-run.
  const week = { startDate: '2030-03-04', endDate: '2030-03-10' };

  it('counts working days, checks the balance and refuses overlaps', async () => {
    const world = await seedBaseWorld();
    const admin = await signIn(world.admin);
    const member = await signIn(world.member);
    await admin.auth(
      api().post('/api/v1/organization/holidays').send({ date: '2030-03-05', name: 'Holi' }),
    );

    const created = await member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'ANNUAL', ...week, reason: 'Family visit' }),
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ days: 4, status: 'PENDING', canDecide: false });

    const overlap = await member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'CASUAL', startDate: '2030-03-08', endDate: '2030-03-08' }),
    );
    expect(errorCode(overlap.body)).toBe('LEAVE_OVERLAP');

    const weekend = await member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'CASUAL', startDate: '2030-03-16', endDate: '2030-03-17' }),
    );
    expect(errorCode(weekend.body)).toBe('LEAVE_NO_WORKING_DAYS');

    const tooLong = await member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'CASUAL', startDate: '2030-04-01', endDate: '2030-04-12' }),
    );
    expect(errorCode(tooLong.body)).toBe('LEAVE_BALANCE_EXCEEDED');

    const balance = await member.auth(api().get('/api/v1/leave/balance').query({ year: 2030 }));
    const annual = balance.body.rows.find((row: { type: string }) => row.type === 'ANNUAL');
    expect(annual).toMatchObject({ allowance: 18, used: 0, pending: 4, remaining: 14 });
  });

  it('is decided by an administrator or the manager, never by the requester', async () => {
    const world = await seedBaseWorld();
    await testDb().user.update({
      where: { id: world.member.id },
      data: { managerId: world.lead.id },
    });
    const member = await signIn(world.member);
    const lead = await signIn(world.lead);
    const outsider = await signIn(world.outsider);

    const created = await member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'SICK', ...week }),
    );
    const id = created.body.id as string;

    const self = await member.auth(
      api().post(`/api/v1/leave/${id}/decide`).send({ approve: true }),
    );
    expect(self.status).toBe(403);
    const stranger = await outsider.auth(
      api().post(`/api/v1/leave/${id}/decide`).send({ approve: true }),
    );
    expect(stranger.status).toBe(403);

    const review = await lead.auth(api().get('/api/v1/leave').query({ scope: 'review' }));
    expect(review.body.data).toHaveLength(1);
    expect(review.body.data[0].canDecide).toBe(true);

    const approved = await lead.auth(
      api().post(`/api/v1/leave/${id}/decide`).send({ approve: true, note: 'Get well soon' }),
    );
    expect(approved.body.status).toBe('APPROVED');

    const again = await lead.auth(
      api().post(`/api/v1/leave/${id}/decide`).send({ approve: false }),
    );
    expect(errorCode(again.body)).toBe('LEAVE_ALREADY_DECIDED');

    // Approved leave shows on the attendance record for each working day.
    const days = await testDb().attendanceDay.findMany({
      where: { userId: world.member.id },
      select: { status: true },
    });
    expect(days).toHaveLength(5);
    expect(days.every((day) => day.status === 'LEAVE')).toBe(true);

    const notifications = await member.auth(api().get('/api/v1/notifications'));
    expect(notifications.body.data.some((n: { type: string }) => n.type === 'LEAVE_DECIDED')).toBe(
      true,
    );

    // Withdrawing future leave removes the attendance rows it created.
    const cancelled = await member.auth(api().post(`/api/v1/leave/${id}/cancel`));
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await testDb().attendanceDay.count({ where: { userId: world.member.id } })).toBe(0);
  });

  it('shows the open tasks that fall due during the leave', async () => {
    const world = await seedProjectWorld();
    await createTask(world, { name: 'Field test', startDate: '2030-03-01', dueDate: '2030-03-06' });
    const created = await world.sessions.member.auth(
      api()
        .post('/api/v1/leave')
        .send({ type: 'ANNUAL', ...week }),
    );
    expect(created.body.affectedTasks).toHaveLength(1);
    expect(created.body.affectedTasks[0].name).toBe('Field test');
  });

  it('keeps everyone’s requests out of reach without leave:manage', async () => {
    const world = await seedBaseWorld();
    const member = await signIn(world.member);
    const all = await member.auth(api().get('/api/v1/leave').query({ scope: 'all' }));
    expect(all.status).toBe(403);
    const otherBalance = await member.auth(
      api().get('/api/v1/leave/balance').query({ userId: world.otherMember.id }),
    );
    expect(otherBalance.status).toBe(403);
  });
});
