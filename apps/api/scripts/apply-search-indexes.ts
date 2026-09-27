/**
 * Full-text search indexes.
 *
 * Prisma cannot express a functional GIN index, so these live here rather than in
 * `schema.prisma`. Every statement is idempotent, and this script runs after every
 * migration (`npm run db:migrate`), so an index that a generated migration removes is
 * restored on the next run rather than silently disappearing.
 *
 * The queries that rely on these indexes are in `src/services/search.service.ts` and
 * `src/services/message.service.ts`; both use bound parameters via tagged templates.
 */
import { PrismaClient } from '@prisma/client';

const STATEMENTS: { name: string; sql: string }[] = [
  {
    name: 'pg_trgm extension',
    sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  },
  {
    name: 'Message body full-text',
    sql: `CREATE INDEX IF NOT EXISTS "message_body_fts_idx"
          ON "Message" USING GIN (to_tsvector('english', "body"))`,
  },
  {
    name: 'Message attachment name trigram',
    sql: `CREATE INDEX IF NOT EXISTS "message_attachment_name_trgm_idx"
          ON "MessageAttachment" USING GIN ("name" gin_trgm_ops)`,
  },
  {
    name: 'Task name full-text',
    sql: `CREATE INDEX IF NOT EXISTS "task_name_fts_idx"
          ON "Task" USING GIN (to_tsvector('english', "name" || ' ' || COALESCE("description", '')))`,
  },
  {
    name: 'Project name trigram',
    sql: `CREATE INDEX IF NOT EXISTS "project_name_trgm_idx"
          ON "Project" USING GIN ("name" gin_trgm_ops)`,
  },
  {
    name: 'User name trigram',
    sql: `CREATE INDEX IF NOT EXISTS "user_fullname_trgm_idx"
          ON "User" USING GIN ("fullName" gin_trgm_ops)`,
  },
  {
    name: 'Document name trigram',
    sql: `CREATE INDEX IF NOT EXISTS "document_name_trgm_idx"
          ON "Document" USING GIN ("name" gin_trgm_ops)`,
  },
  {
    // At most one work session may be open per user at any time (spec section 29).
    // A partial unique index enforces it in the database, not only in the service.
    name: 'One open work session per user',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "work_session_single_open_idx"
          ON "WorkSession" ("userId") WHERE "endedAt" IS NULL`,
  },
  {
    name: 'One open break per work session',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "break_session_single_open_idx"
          ON "BreakSession" ("workSessionId") WHERE "endedAt" IS NULL`,
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const statement of STATEMENTS) {
      await prisma.$executeRawUnsafe(statement.sql);
      console.log(`  applied: ${statement.name}`);
    }
    console.log(`\n${STATEMENTS.length} search and constraint indexes are in place.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Failed to apply search indexes:', error);
  process.exitCode = 1;
});
