import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, errorCode, signIn } from '../helpers/api.js';
import { closeDatabase, resetDatabase, testDb } from '../helpers/db.js';
import { seedOrganization, seedUser, TEST_PASSWORD } from '../helpers/fixtures.js';

describe('authentication', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('signs a user in and returns their permissions', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id, { role: 'SUPER_ADMIN' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.email).toBe(user.email);
    expect(response.body.user.permissions).toContain('project:create');
  });

  it('never returns the password hash', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(JSON.stringify(response.body)).not.toContain('argon2');
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('sets a refresh cookie that JavaScript cannot read', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((cookie) => cookie.startsWith('ekavist_refresh='));
    expect(refresh).toBeDefined();
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('SameSite=Strict');
  });

  it('rejects a wrong password with the same message as an unknown address', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not-the-password' });
    const unknownEmail = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@ekavist.test', password: TEST_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(errorCode(wrongPassword.body)).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a disabled account', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id, { status: 'INACTIVE' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ACCOUNT_DISABLED');
  });

  it('stops honouring a token once the account is deactivated', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);
    const session = await signIn(user);

    const before = await session.auth(api().get('/api/v1/auth/me'));
    expect(before.status).toBe(200);

    await testDb().user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const after = await session.auth(api().get('/api/v1/auth/me'));
    expect(after.status).toBe(403);
    expect(errorCode(after.body)).toBe('ACCOUNT_DISABLED');
  });

  it('refuses a request with no token', async () => {
    const response = await api().get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
  });

  it('refuses a token that was not signed by this server', async () => {
    const response = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('TOKEN_INVALID');
  });

  it('records the successful and the failed attempt in the audit log', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    await api().post('/api/v1/auth/login').send({ email: user.email, password: 'wrong' });
    await api().post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });

    const entries = await testDb().auditLog.findMany({
      where: { entityId: user.id },
      select: { action: true },
    });
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('auth.login.failed');
    expect(actions).toContain('auth.login');
  });
});

describe('refresh tokens', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rotates the token and keeps the session alive', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);
    const agent = api();

    await agent.post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    const refreshed = await agent.post('/api/v1/auth/refresh').send();

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });

  it('revokes the whole family when a rotated token is presented again', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    const original = extractRefreshCookie(login.headers['set-cookie'] as unknown as string[]);

    // First use rotates it.
    const first = await api().post('/api/v1/auth/refresh').set('Cookie', original).send();
    expect(first.status).toBe(200);

    // Replaying the original is treated as a leak.
    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', original).send();
    expect(replay.status).toBe(401);
    expect(errorCode(replay.body)).toBe('REFRESH_TOKEN_REUSED');

    // And the token issued by the first rotation no longer works either.
    const rotated = extractRefreshCookie(first.headers['set-cookie'] as unknown as string[]);
    const afterRevoke = await api().post('/api/v1/auth/refresh').set('Cookie', rotated).send();
    expect(afterRevoke.status).toBe(401);
  });

  it('stops working after logout', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);
    const agent = api();

    await agent.post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    await agent.post('/api/v1/auth/logout').send();

    const response = await agent.post('/api/v1/auth/refresh').send();
    expect(response.status).toBe(401);
  });
});

describe('password reset', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('answers the same whether or not the address exists', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    const known = await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@ekavist.test' });

    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
  });

  it('queues an email only for a real account', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@ekavist.test' });

    const queued = await testDb().emailNotification.findMany({ select: { toEmail: true } });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.toEmail).toBe(user.email);
  });

  it('does not report an email as sent before the transport accepted it', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

    const row = await testDb().emailNotification.findFirstOrThrow();
    expect(row.status).toBe('QUEUED');
    expect(row.sentAt).toBeNull();
  });

  it('lets the user sign in with the new password and ends old sessions', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);
    const agent = api();
    await agent.post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });

    await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    // The token is only ever sent by email, so the test reads it the way the user would:
    // from the queued message payload.
    const email = await testDb().emailNotification.findFirstOrThrow();
    const token = (email.payload as { token: string }).token;

    const reset = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a-brand-new-password' });
    expect(reset.status).toBe(204);

    const signedIn = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'a-brand-new-password' });
    expect(signedIn.status).toBe(200);

    const oldSession = await agent.post('/api/v1/auth/refresh').send();
    expect(oldSession.status).toBe(401);
  });

  it('refuses a token that has already been used', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);

    await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const email = await testDb().emailNotification.findFirstOrThrow();
    const token = (email.payload as { token: string }).token;

    await api().post('/api/v1/auth/reset-password').send({ token, password: 'first-new-password' });
    const second = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'second-new-password' });

    expect(second.status).toBe(401);
    expect(errorCode(second.body)).toBe('TOKEN_INVALID');
  });

  it('rejects a password that is too short, naming the field', async () => {
    const response = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(32), password: 'short' });

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'password' }),
    );
  });
});

describe('changing a password', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('requires the current password', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);
    const session = await signIn(user);

    const response = await session.auth(
      api()
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'wrong', newPassword: 'a-new-long-password' }),
    );

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('PASSWORD_INCORRECT');
  });

  it('changes the password and signs other sessions out', async () => {
    const org = await seedOrganization();
    const user = await seedUser(org.id);
    const session = await signIn(user);

    const response = await session.auth(
      api()
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-new-long-password' }),
    );
    expect(response.status).toBe(204);

    const withNew = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'a-new-long-password' });
    expect(withNew.status).toBe(200);

    const tokens = await testDb().refreshToken.findMany({ where: { userId: user.id } });
    const stillLive = tokens.filter((token) => token.revokedAt == null);
    // Only the session created by the new sign-in above remains.
    expect(stillLive).toHaveLength(1);
  });
});

function extractRefreshCookie(setCookie: string[]): string {
  const cookie = setCookie.find((value) => value.startsWith('ekavist_refresh='));
  if (cookie == null) throw new Error('The login response did not set a refresh cookie.');
  return cookie.split(';')[0] as string;
}
