/**
 * Test database helpers.
 *
 * `resetDatabase` truncates every table rather than dropping the schema: it is far faster
 * between test files, and it keeps the indexes that the search tests depend on.
 */
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function testDb(): PrismaClient {
  client ??= new PrismaClient({
    datasources: { db: { url: process.env['DATABASE_URL'] as string } },
    log: [],
  });
  return client;
}

/** Table names, discovered once so a new model does not need a code change here. */
let tableNames: string[] | null = null;

async function loadTableNames(db: PrismaClient): Promise<string[]> {
  if (tableNames != null) return tableNames;
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  tableNames = rows.map((row) => `"public"."${row.tablename}"`);
  return tableNames;
}

export async function resetDatabase(): Promise<void> {
  const db = testDb();
  const tables = await loadTableNames(db);
  if (tables.length === 0) return;
  // RESTART IDENTITY keeps sequences predictable; CASCADE handles the foreign keys.
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function closeDatabase(): Promise<void> {
  if (client != null) {
    await client.$disconnect();
    client = null;
  }
}
