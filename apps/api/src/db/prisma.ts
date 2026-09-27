/**
 * The Prisma client, and the transaction type services accept.
 *
 * Services take a `Db` rather than importing `prisma` directly whenever they may need to
 * participate in a caller's transaction. That is what lets a task write, its progress
 * rollup, its audit entry and its activity entry all commit or fail together.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Model access that works both on the root client and inside an interactive transaction.
 * Services take this whenever they may be called as part of a larger unit of work.
 */
export type Db = Prisma.TransactionClient;

/**
 * The root client. Required by services that open a transaction of their own, which also
 * documents that such a service cannot be nested inside someone else's transaction.
 */
export type RootDb = PrismaClient;

declare global {
  // Reusing the client across hot reloads avoids exhausting the connection pool in dev.

  var __ekavistPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: env.isDevelopment
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });

  client.$on('error', (event) => logger.error({ prisma: event }, 'Database error'));
  if (env.isDevelopment) {
    client.$on('warn', (event) => logger.warn({ prisma: event }, 'Database warning'));
  }
  return client;
}

export const prisma: PrismaClient = globalThis.__ekavistPrisma ?? createClient();

if (env.isDevelopment) {
  globalThis.__ekavistPrisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Translates the Prisma errors worth reacting to. Anything else is left alone so it
 * surfaces as an unexpected fault rather than being mislabelled.
 */
export function isUniqueConstraintError(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!target) return true;
  const fields = error.meta?.['target'];
  if (Array.isArray(fields)) return fields.includes(target);
  return typeof fields === 'string' && fields.includes(target);
}

export function isForeignKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

export function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export { Prisma };
