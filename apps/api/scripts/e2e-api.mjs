/**
 * Starts the API for the end-to-end run.
 *
 * It points at the *test* database on a separate port, applies the migrations and the
 * indexes, resets the data and seeds a known fixture. Playwright waits on the health
 * endpoint, so by the time a test runs the stack is genuinely ready.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

loadDotenv({ path: path.join(repoRoot, '.env') });

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'TEST_DATABASE_URL is not set. Copy .env.example to .env and start the database with `npm run db:up`.',
  );
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  API_PORT: '4100',
  APP_URL: 'http://localhost:4173',
  API_URL: 'http://localhost:4100',
  // The journeys assert on what the UI shows, not on delivered mail, and a background
  // scheduler would make the assertions depend on the clock.
  EMAIL_TRANSPORT: 'console',
  JOBS_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  // Nine journeys sign in a dozen times inside a minute, all from one address. The
  // default of ten per minute is the right protection against password guessing in
  // production and simply the wrong number for a test harness, so the harness raises it
  // rather than the product weakening it.
  RATE_LIMIT_AUTH_MAX: '500',
};

function resolveBin(packageName, relativeEntry) {
  for (const base of [apiRoot, repoRoot]) {
    const candidate = path.join(base, 'node_modules', packageName, relativeEntry);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find ${packageName}. Run "npm install" first.`);
}

const tsx = resolveBin('tsx', 'dist/cli.mjs');

console.log('Preparing the end-to-end database…');
execFileSync(process.execPath, [resolveBin('prisma', 'build/index.js'), 'migrate', 'deploy'], {
  cwd: apiRoot,
  env,
  stdio: 'inherit',
});
execFileSync(process.execPath, [tsx, path.join(apiRoot, 'scripts', 'apply-search-indexes.ts')], {
  cwd: apiRoot,
  env,
  stdio: 'inherit',
});
execFileSync(process.execPath, [path.join(here, 'e2e-seed.mjs')], {
  cwd: apiRoot,
  env,
  stdio: 'inherit',
});

console.log('Starting the API on port 4100…');
const server = spawn(process.execPath, [tsx, path.join(apiRoot, 'src', 'server.ts')], {
  cwd: apiRoot,
  env,
  stdio: 'inherit',
});

const stop = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
