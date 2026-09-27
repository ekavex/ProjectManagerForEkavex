/**
 * Environment configuration.
 *
 * Every value the application depends on is read once, here, and validated. A missing or
 * malformed variable fails at startup with a readable message rather than surfacing as an
 * odd runtime error hours later. Nothing outside this module reads `process.env`.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config -> src -> apps/api -> apps -> repository root
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) {
  loadDotenv({ path: envFile });
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time of day as HH:mm.');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  TEST_DATABASE_URL: z.string().optional(),

  AUTH_JWT_SECRET: z
    .string()
    .min(
      32,
      "AUTH_JWT_SECRET must be at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    ),
  AUTH_ACCESS_TOKEN_TTL: z.string().default('15m'),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUTH_PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  AUTH_COOKIE_SECURE: booleanish.default(false),

  ORG_NAME: z.string().default('Ekavist'),
  ORG_TIMEZONE: z.string().default('Asia/Kolkata'),
  ORG_WORKDAY_START: timeOfDay.default('09:30'),
  ORG_LATE_AFTER: timeOfDay.default('10:00'),

  EMAIL_TRANSPORT: z.enum(['smtp', 'json', 'console']).default('json'),
  EMAIL_HOST: z.string().default('localhost'),
  EMAIL_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  EMAIL_SECURE: booleanish.default(false),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('Ekavist <no-reply@ekavist.local>'),

  JOBS_ENABLED: booleanish.default(true),
  JOBS_DEADLINE_SCAN_CRON: z.string().default('0 8 * * *'),
  JOBS_OVERDUE_SCAN_CRON: z.string().default('15 8 * * *'),
  JOBS_DAILY_SUMMARY_CRON: z.string().default('0 18 * * *'),
  JOBS_WEEKLY_SUMMARY_CRON: z.string().default('0 9 * * 1'),
  JOBS_CONSISTENCY_SCAN_CRON: z.string().default('0 2 * * *'),
  JOBS_MAIL_DISPATCH_CRON: z.string().default('*/2 * * * *'),

  UPLOAD_DIR: z.string().default('./uploads'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(10 * 1024 * 1024),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
});

function parseEnv(): z.infer<typeof schema> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(
      `Invalid environment configuration.\n${lines.join('\n')}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }
  return result.data;
}

const parsed = parseEnv();

const isTest = parsed.NODE_ENV === 'test';

export const env = {
  ...parsed,
  /** Integration tests are pointed at a separate database so a run cannot truncate dev data. */
  DATABASE_URL: isTest ? (parsed.TEST_DATABASE_URL ?? parsed.DATABASE_URL) : parsed.DATABASE_URL,
  isProduction: parsed.NODE_ENV === 'production',
  isDevelopment: parsed.NODE_ENV === 'development',
  isTest,
  repoRoot,
  uploadDir: path.isAbsolute(parsed.UPLOAD_DIR)
    ? parsed.UPLOAD_DIR
    : path.resolve(repoRoot, parsed.UPLOAD_DIR),
} as const;

export type Env = typeof env;

/**
 * Guards that only matter in production, checked at startup so a misconfigured deployment
 * fails loudly rather than running with development defaults.
 */
export function assertProductionSafety(): void {
  if (!env.isProduction) return;

  const problems: string[] = [];
  if (env.AUTH_JWT_SECRET.includes('change-me')) {
    problems.push('AUTH_JWT_SECRET is still the example value.');
  }
  if (!env.AUTH_COOKIE_SECURE) {
    problems.push('AUTH_COOKIE_SECURE must be true so the refresh cookie is HTTPS-only.');
  }
  if (env.EMAIL_TRANSPORT !== 'smtp') {
    problems.push(
      `EMAIL_TRANSPORT is "${env.EMAIL_TRANSPORT}": email would not actually be delivered.`,
    );
  }
  if (!env.APP_URL.startsWith('https://')) {
    problems.push('APP_URL should be an https origin in production.');
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
