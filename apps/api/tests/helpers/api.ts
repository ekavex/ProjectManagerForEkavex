/**
 * Supertest helpers.
 *
 * `signIn` goes through the real login endpoint rather than minting a token directly, so
 * every test exercises the same path a browser would.
 */
import type { LoginResponse } from '@ekavist/shared';
import type { Express } from 'express';
import supertest, { type Agent } from 'supertest';
import { createApp } from '../../src/http/app.js';
import type { SeededUser } from './fixtures.js';

let app: Express | null = null;

export function api(): Agent {
  app ??= createApp();
  return supertest.agent(app);
}

export interface Session {
  token: string;
  user: LoginResponse['user'];
  /** Adds the Authorization header to a Supertest request. */
  auth: <T extends { set: (field: string, value: string) => T }>(request: T) => T;
}

export async function signIn(user: SeededUser): Promise<Session> {
  const response = await api()
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });

  if (response.status !== 200) {
    throw new Error(
      `Sign-in failed for ${user.email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  const login = response.body as LoginResponse;
  return {
    token: login.accessToken,
    user: login.user,
    auth: (request) => request.set('Authorization', `Bearer ${login.accessToken}`),
  };
}

/** Convenience for the common `expect(response.body.error.code).toBe(...)` assertion. */
export function errorCode(body: unknown): string | undefined {
  if (body == null || typeof body !== 'object') return undefined;
  const error = (body as { error?: { code?: string } }).error;
  return error?.code;
}
