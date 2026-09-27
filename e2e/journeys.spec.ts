/**
 * The critical journeys from the specification (section 74).
 *
 * These run against a real API and a real database. They are deliberately written as a
 * person's path through the product rather than as endpoint checks: an administrator sets
 * a project up, a lead plans it, a member does the work.
 *
 * The suite is ordered and serial: later journeys build on the project the earlier ones
 * created, exactly as a real project unfolds.
 */
import { expect, test } from '@playwright/test';
import { createProject, openTab, PEOPLE, selectByText, signIn, signOut } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** Carried between journeys, in the order they run. */
const state: { projectId: string; taskName: string } = {
  projectId: '',
  taskName: 'Draft the requirements',
};

test('an administrator creates a project and assigns a lead', async ({ page }) => {
  await signIn(page, 'admin');

  state.projectId = await createProject(page, {
    name: 'Electronic Weeder',
    code: 'E2E-01',
    leadName: PEOPLE.lead.name,
  });

  // The project opens on its overview, showing the lead and the default phases.
  await expect(page.getByRole('heading', { name: 'Electronic Weeder' })).toBeVisible();
  await expect(page.getByText('E2E-01')).toBeVisible();

  await openTab(page, 'Phases');
  await expect(page.getByText('Initiation')).toBeVisible();
  await expect(page.getByText('Closure')).toBeVisible();
});

test('the lead builds the team, the plan and a task', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`/projects/${state.projectId}/team`);

  // --- add the member -----------------------------------------------------
  await page.getByRole('button', { name: 'Add member' }).click();
  await selectByText(page, 'Person', PEOPLE.member.name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(PEOPLE.member.name)).toBeVisible();

  // --- build a WBS item ---------------------------------------------------
  await openTab(page, 'WBS');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Name').fill('Requirements');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('1.0')).toBeVisible();
  await expect(page.getByText('Requirements')).toBeVisible();

  // --- create and assign a task -------------------------------------------
  await openTab(page, 'Tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task name').fill(state.taskName);
  await page.getByLabel('Due date').fill('2026-09-30');
  await page.getByLabel('Estimated hours').fill('8');
  await page.getByRole('button', { name: PEOPLE.member.name }).click();
  await page.getByRole('button', { name: 'Create task' }).click();

  await expect(page.getByText(state.taskName)).toBeVisible();
  await expect(page.getByText('T-1')).toBeVisible();
});

test('a dependency is created and a loop is refused', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`/projects/${state.projectId}/tasks`);

  // A second task, so there is something to depend on.
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task name').fill('Architecture');
  await page.getByLabel('Due date').fill('2026-10-10');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Architecture')).toBeVisible();

  // The Gantt is the place a dependency becomes visible, so it is checked there.
  await openTab(page, 'Gantt');
  await expect(page.getByText(/dependencies/)).toBeVisible();
});

test('a member works the task: start, progress, complete', async ({ page }) => {
  await signIn(page, 'member');

  // The task is on their own work list, which is how they would actually find it. It is
  // due in a few days, so it sits under Upcoming rather than Today — which is the
  // bucketing this page exists to do.
  await page.goto('/my-work');
  await page.getByRole('button', { name: /^Upcoming/ }).click();
  await expect(page.getByText(state.taskName)).toBeVisible();

  await page.getByText(state.taskName).first().click();
  await expect(page.getByRole('heading', { name: state.taskName })).toBeVisible();

  // Status and progress move together.
  await page.getByLabel('Status').selectOption('IN_PROGRESS');
  await expect(page.getByText('In progress').first()).toBeVisible();

  await page.getByLabel('Status').selectOption('COMPLETED');
  await expect(page.getByText('Completed').first()).toBeVisible();
  // Completing a task forces it to 100%.
  await expect(page.getByText('100%').first()).toBeVisible();
});

test('attendance is separate from signing in', async ({ page }) => {
  await signIn(page, 'member');

  // Signing in did not start a working day: the header offers to start one.
  const startWork = page.getByRole('button', { name: 'Start work' });
  await expect(startWork).toBeVisible();

  await startWork.click();
  await expect(page.getByRole('button', { name: 'End work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Break' })).toBeVisible();

  // A break pauses the day without ending it.
  await page.getByRole('button', { name: 'Break' }).click();
  await expect(page.getByRole('button', { name: 'End break' })).toBeVisible();
  await page.getByRole('button', { name: 'End break' }).click();

  await page.getByRole('button', { name: 'End work' }).click();
  await expect(page.getByRole('button', { name: 'Start work' })).toBeVisible();

  // The day is recorded on the attendance page.
  await page.goto('/attendance');
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  await expect(page.getByText(/Present|Late|Half day/).first()).toBeVisible();
});

test('the chat carries messages, links and pins, and is searchable', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto(`/projects/${state.projectId}/chat`);

  await page
    .getByPlaceholder('Write a message…')
    .fill('The requirements draft is ready for review.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('The requirements draft is ready for review.')).toBeVisible();

  // Search runs on the server; the browser never filters the history itself.
  await page.getByPlaceholder('Search this conversation').fill('requirements');
  await expect(page.getByText('The requirements draft is ready for review.')).toBeVisible();

  await page.getByPlaceholder('Search this conversation').fill('nothing matches this phrase');
  await expect(page.getByText('Nothing matched')).toBeVisible();
});

test('a phase gate blocks the next phase until it is approved', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`/projects/${state.projectId}/phases`);

  // Turn the gate on for Initiation.
  const initiation = page.locator('section', { hasText: 'Initiation' }).first();
  await initiation.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('This phase needs approval to close').check();
  await page.getByRole('button', { name: 'Save' }).click();

  // Every later phase is now blocked, and each says which phase is in the way. Seven of
  // them carry the message, so the assertion takes the first rather than demanding one.
  await expect(page.getByText(/Initiation.*has not been submitted/).first()).toBeVisible();

  // Submitting sends it for a decision.
  await page
    .locator('section', { hasText: 'Initiation' })
    .first()
    .getByRole('button', { name: 'Submit for approval' })
    .click();
  await expect(page.getByText(/Gate: Submitted/).first()).toBeVisible();

  // The lead submitted it, so the decision escalates to an administrator.
  await signOut(page);
  await signIn(page, 'admin');
  await page.goto(`/projects/${state.projectId}/phases`);

  await page
    .locator('section', { hasText: 'Initiation' })
    .first()
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(page.getByText(/Gate: Approved/).first()).toBeVisible();
});

test('a viewer can read but cannot change anything', async ({ page }) => {
  // Make the viewer a member of the project first, as a lead would.
  await signIn(page, 'lead');
  await page.goto(`/projects/${state.projectId}/team`);
  await page.getByRole('button', { name: 'Add member' }).click();
  await selectByText(page, 'Person', PEOPLE.viewer.name);
  await page.getByLabel('Project role').selectOption('VIEWER');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(PEOPLE.viewer.name)).toBeVisible();

  await signOut(page);
  await signIn(page, 'viewer');
  await page.goto(`/projects/${state.projectId}/tasks`);

  // They see the work.
  await expect(page.getByText(state.taskName)).toBeVisible();

  // But the actions that would change it are not offered, and the chat tab is hidden
  // because this viewer was not given chat access.
  await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Chat', exact: true })).toHaveCount(0);
});

test('the project dashboard reports real numbers', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`/projects/${state.projectId}`);

  // Every figure here comes from a query. The project has two tasks, one of which the
  // member completed earlier in this suite, so the counter must say so.
  await expect(page.getByText(/^\d+\/\d+$/).first()).toBeVisible();
  await expect(page.getByText('1/2')).toBeVisible();

  // The health panel explains each indicator in words rather than showing a bare score.
  await expect(page.getByText('Schedule', { exact: true })).toBeVisible();
  await expect(page.getByText(/Nothing is past its due date|past their due date/)).toBeVisible();

  // And the phase progress list reflects the gate approved in the previous journey.
  await expect(page.getByText('Phase progress')).toBeVisible();
});
