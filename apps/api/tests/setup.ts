/**
 * Per-file test setup: points the process at the test database before any module that
 * reads the environment is imported.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

loadDotenv({ path: path.join(repoRoot, '.env') });

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['EMAIL_TRANSPORT'] = 'console';
process.env['JOBS_ENABLED'] = 'false';

const testUrl = process.env['TEST_DATABASE_URL'];
if (testUrl) {
  // `env.ts` also prefers TEST_DATABASE_URL under NODE_ENV=test; setting it here as well
  // covers anything that reads DATABASE_URL directly, such as the Prisma CLI.
  process.env['DATABASE_URL'] = testUrl;
}

if (!process.env['AUTH_JWT_SECRET'] || process.env['AUTH_JWT_SECRET'].length < 32) {
  process.env['AUTH_JWT_SECRET'] = 'test-secret-value-that-is-long-enough-for-validation';
}
