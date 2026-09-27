/** Shared helpers for the end-to-end journeys. */
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password-2026';

export const PEOPLE = {
  admin: { email: 'e2e-admin@ekavist.test', name: 'Ada Admin' },
  lead: { email: 'e2e-lead@ekavist.test', name: 'Leo Lead' },
  member: { email: 'e2e-member@ekavist.test', name: 'Mira Member' },
  viewer: { email: 'e2e-viewer@ekavist.test', name: 'Vera Viewer' },
} as const;

export async function signIn(page: Page, who: keyof typeof PEOPLE): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(PEOPLE[who].email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // A failed sign-in shows its reason on the form. Surfacing it here turns a confusing
  // "expected Leo, got Sign in to Ekavist" into the actual problem.
  const failure = page.getByRole('alert');
  if ((await failure.count()) > 0) {
    throw new Error(
      `Sign-in failed for ${PEOPLE[who].email}: ${await failure.first().innerText()}`,
    );
  }

  // The dashboard greets the person by their first name, which is a far better signal
  // that sign-in worked than merely the URL changing.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    PEOPLE[who].name.split(' ')[0] as string,
  );
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * Chooses the option whose visible text contains `text`.
 *
 * `selectOption` matches a label exactly, and these dropdowns render composites such as
 * "Leo Lead — Project Lead". Reading the option's value first keeps the test tied to the
 * person's name rather than to the exact formatting beside it.
 */
export async function selectByText(page: Page, label: string, text: string): Promise<void> {
  const select = page.getByLabel(label);
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');

  if (value == null || value === '') {
    throw new Error(`No option containing "${text}" in the "${label}" dropdown.`);
  }
  await select.selectOption(value);
}

/** Creates a project as an administrator and returns its id from the URL. */
export async function createProject(
  page: Page,
  options: { name: string; code: string; leadName: string },
): Promise<string> {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();

  await page.getByLabel('Project name').fill(options.name);
  await page.getByLabel('Project code').fill(options.code);
  await selectByText(page, 'Project lead', options.leadName);
  await page.getByLabel('Start date').fill('2026-09-01');
  await page.getByLabel('Planned completion').fill('2026-12-15');

  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  const match = /\/projects\/([a-z0-9]+)/.exec(page.url());
  if (match?.[1] == null) throw new Error(`Could not read a project id from ${page.url()}`);
  return match[1];
}

export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name, exact: true }).click();
}
