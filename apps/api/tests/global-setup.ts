/**
 * Prepares the test database once per run.
 *
 * Integration tests run against a real PostgreSQL database (`ekavist_test`), never a mock,
 * because the schema depends on Postgres behaviour the tests are there to verify. This
 * applies the migrations and the search/constraint indexes before any suite starts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

/**
 * Resolves a CLI to the JavaScript file npm installed, rather than shelling out to `npx`.
 *
 * `npx` needs a terminal: with no stdin attached it can sit waiting for an install
 * prompt, which makes a background test run hang with no output at all. Running the
 * entry point with the current Node binary removes the shell from the picture entirely.
 */
function resolveBin(packageName: string, relativeEntry: string): string {
  for (const base of [apiRoot, repoRoot]) {
    const candidate = path.join(base, 'node_modules', packageName, relativeEntry);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${packageName}/${relativeEntry}. Run "npm install" before the tests.`,
  );
}

export default async function setup(): Promise<void> {
  loadDotenv({ path: path.join(repoRoot, '.env') });

  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and start the database with `npm run db:up`.',
    );
  }
  if (url === process.env['DATABASE_URL']) {
    throw new Error(
      'TEST_DATABASE_URL must differ from DATABASE_URL. Tests truncate every table and would destroy development data.',
    );
  }

  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
  const run = (args: string[]): void => {
    execFileSync(process.execPath, args, {
      cwd: apiRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  };

  // `npm ci` does not generate the client, and `migrate deploy` — unlike `migrate dev` —
  // does not either. Without this the first thing to import `@prisma/client` on a fresh
  // checkout dies with "did not initialize yet", which is exactly how CI failed the first
  // time it ran.
  run([resolveBin('prisma', 'build/index.js'), 'generate']);
  run([resolveBin('prisma', 'build/index.js'), 'migrate', 'deploy']);
  run([
    resolveBin('tsx', 'dist/cli.mjs'),
    path.join(apiRoot, 'scripts', 'apply-search-indexes.ts'),
  ]);
}
