import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The journeys run against a real stack: a real API against the test database, and the
 * built web app. Playwright starts both, so `npm run test:e2e` works from a clean clone
 * without anything already running.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // The journeys share one database, so they run one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run e2e:api --workspace @ekavist/api',
      url: 'http://localhost:4100/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run e2e:web --workspace @ekavist/web',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
