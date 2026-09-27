/**
 * Email templates (spec section 42).
 *
 * Plain, readable HTML with a text alternative. Every value is escaped: a task name is
 * user input and must not be able to inject markup into someone's inbox.
 */
import { env } from '../config/env.js';

export type TemplateName =
  | 'password-reset'
  | 'account-created'
  | 'task-assigned'
  | 'task-due-soon'
  | 'task-overdue'
  | 'project-assigned'
  | 'project-member-added'
  | 'mention'
  | 'phase-approval-required'
  | 'phase-decided'
  | 'change-request-created'
  | 'change-request-decided'
  | 'risk-assigned'
  | 'issue-assigned'
  | 'lead-overdue-digest'
  | 'daily-summary'
  | 'weekly-summary';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Block {
  heading: string;
  intro: string;
  /** Label and value pairs shown as a definition list. */
  facts?: { label: string; value: string }[];
  bullets?: string[];
  action?: { label: string; path: string };
  outro?: string;
}

function link(path: string): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function layout(block: Block): RenderedMail {
  const url = block.action ? link(block.action.path) : null;

  const factsHtml =
    block.facts && block.facts.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${block.facts
          .map(
            (fact) =>
              `<tr><td style="padding:4px 16px 4px 0;color:#64748b;font-size:14px">${escapeHtml(fact.label)}</td><td style="padding:4px 0;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(fact.value)}</td></tr>`,
          )
          .join('')}</table>`
      : '';

  const bulletsHtml =
    block.bullets && block.bullets.length > 0
      ? `<ul style="margin:16px 0;padding-left:20px;color:#0f172a;font-size:14px;line-height:1.6">${block.bullets
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`
      : '';

  const actionHtml = url
    ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block">${escapeHtml(block.action?.label ?? 'Open')}</a></p>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:28px">
    <p style="margin:0 0 20px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;font-weight:700">Ekavist</p>
    <h1 style="margin:0 0 12px;font-size:19px;color:#0f172a">${escapeHtml(block.heading)}</h1>
    <p style="margin:0;color:#334155;font-size:14px;line-height:1.6">${escapeHtml(block.intro)}</p>
    ${factsHtml}
    ${bulletsHtml}
    ${actionHtml}
    ${block.outro ? `<p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.6">${escapeHtml(block.outro)}</p>` : ''}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px">
    <p style="margin:0;color:#94a3b8;font-size:12px">You are receiving this because of your Ekavist notification settings. You can change them under Settings, Notifications.</p>
  </div>
</body></html>`;

  const textLines = [
    block.heading,
    '',
    block.intro,
    ...(block.facts?.map((fact) => `${fact.label}: ${fact.value}`) ?? []),
    ...(block.bullets?.map((item) => `- ${item}`) ?? []),
    ...(url ? ['', `${block.action?.label ?? 'Open'}: ${url}`] : []),
    ...(block.outro ? ['', block.outro] : []),
  ];

  return { subject: block.heading, text: textLines.join('\n'), html };
}

/** The payload each template expects. Keys are kept flat so the outbox row is readable. */
export type TemplatePayload = Record<string, string | number | boolean | null | string[]>;

function str(payload: TemplatePayload, key: string, fallback = ''): string {
  const value = payload[key];
  if (value == null) return fallback;
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function list(payload: TemplatePayload, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Renders a template. An unknown name falls back to a generic notification rather than
 * throwing, so a scheduler cannot be brought down by a typo in a job.
 */
export function renderTemplate(name: TemplateName, payload: TemplatePayload): RenderedMail {
  switch (name) {
    case 'password-reset':
      return layout({
        heading: 'Reset your Ekavist password',
        intro: `Hello ${str(payload, 'name', 'there')}, we received a request to reset your password.`,
        action: {
          label: 'Choose a new password',
          path: `/reset-password?token=${str(payload, 'token')}`,
        },
        outro: `This link expires in ${str(payload, 'expiresInMinutes', '60')} minutes. If you did not ask for this, you can ignore this message — your password has not changed.`,
      });

    case 'account-created':
      return layout({
        heading: 'Your Ekavist account is ready',
        intro: `Hello ${str(payload, 'name', 'there')}, an account has been created for you by ${str(payload, 'createdBy', 'your administrator')}.`,
        facts: [{ label: 'Sign in with', value: str(payload, 'email') }],
        action: {
          label: 'Set your password',
          path: `/reset-password?token=${str(payload, 'token')}`,
        },
      });

    case 'task-assigned':
      return layout({
        heading: `You have been assigned ${str(payload, 'reference')}`,
        intro: `${str(payload, 'assignedBy', 'A project lead')} assigned you a task in ${str(payload, 'projectName')}.`,
        facts: [
          { label: 'Task', value: str(payload, 'taskName') },
          { label: 'Due', value: str(payload, 'dueDate', 'No due date') },
          { label: 'Priority', value: str(payload, 'priority') },
        ],
        action: {
          label: 'Open the task',
          path: `/projects/${str(payload, 'projectId')}/tasks/${str(payload, 'taskId')}`,
        },
      });

    case 'task-due-soon':
      return layout({
        heading: `${str(payload, 'reference')} is due ${str(payload, 'whenLabel', 'soon')}`,
        intro: `A reminder about your task in ${str(payload, 'projectName')}.`,
        facts: [
          { label: 'Task', value: str(payload, 'taskName') },
          { label: 'Due', value: str(payload, 'dueDate') },
          { label: 'Progress', value: `${str(payload, 'progress', '0')}%` },
        ],
        action: {
          label: 'Open the task',
          path: `/projects/${str(payload, 'projectId')}/tasks/${str(payload, 'taskId')}`,
        },
      });

    case 'task-overdue':
      return layout({
        heading: `${str(payload, 'reference')} is overdue`,
        intro: `This task in ${str(payload, 'projectName')} passed its due date ${str(payload, 'daysOverdue', '1')} day(s) ago.`,
        facts: [
          { label: 'Task', value: str(payload, 'taskName') },
          { label: 'Was due', value: str(payload, 'dueDate') },
          { label: 'Progress', value: `${str(payload, 'progress', '0')}%` },
        ],
        action: {
          label: 'Update the task',
          path: `/projects/${str(payload, 'projectId')}/tasks/${str(payload, 'taskId')}`,
        },
      });

    case 'project-assigned':
      return layout({
        heading: `You are now leading ${str(payload, 'projectName')}`,
        intro: `${str(payload, 'assignedBy', 'An administrator')} made you the project lead.`,
        facts: [
          {
            label: 'Project',
            value: `${str(payload, 'projectCode')} — ${str(payload, 'projectName')}`,
          },
          { label: 'Target date', value: str(payload, 'plannedEndDate') },
        ],
        action: { label: 'Open the project', path: `/projects/${str(payload, 'projectId')}` },
      });

    case 'project-member-added':
      return layout({
        heading: `You have been added to ${str(payload, 'projectName')}`,
        intro: `${str(payload, 'addedBy', 'A project lead')} added you to the project as ${str(payload, 'projectRole', 'a member')}.`,
        action: { label: 'Open the project', path: `/projects/${str(payload, 'projectId')}` },
      });

    case 'mention':
      return layout({
        heading: `${str(payload, 'authorName')} mentioned you`,
        intro: `In the ${str(payload, 'projectName')} chat: "${str(payload, 'excerpt')}"`,
        action: {
          label: 'Open the conversation',
          path: `/projects/${str(payload, 'projectId')}/chat?message=${str(payload, 'messageId')}`,
        },
      });

    case 'phase-approval-required':
      return layout({
        heading: `Approval needed: ${str(payload, 'phaseName')}`,
        intro: `${str(payload, 'submittedBy')} submitted a phase for your approval in ${str(payload, 'projectName')}.`,
        facts: [
          { label: 'Phase', value: str(payload, 'phaseName') },
          { label: 'Outstanding tasks', value: str(payload, 'incompleteTasks', '0') },
        ],
        action: {
          label: 'Review the phase',
          path: `/projects/${str(payload, 'projectId')}/phases/${str(payload, 'phaseId')}`,
        },
      });

    case 'phase-decided':
      return layout({
        heading: `${str(payload, 'phaseName')} was ${str(payload, 'decision')}`,
        intro: `${str(payload, 'decidedBy')} reviewed the phase in ${str(payload, 'projectName')}.`,
        facts: [{ label: 'Note', value: str(payload, 'note', 'No note was added.') }],
        action: {
          label: 'Open the phase',
          path: `/projects/${str(payload, 'projectId')}/phases/${str(payload, 'phaseId')}`,
        },
      });

    case 'change-request-created':
      return layout({
        heading: `Change request ${str(payload, 'reference')}`,
        intro: `${str(payload, 'requesterName')} raised a change request in ${str(payload, 'projectName')}.`,
        facts: [{ label: 'Title', value: str(payload, 'title') }],
        action: {
          label: 'Review the request',
          path: `/projects/${str(payload, 'projectId')}/change-requests/${str(payload, 'changeRequestId')}`,
        },
      });

    case 'change-request-decided':
      return layout({
        heading: `Change request ${str(payload, 'reference')} was ${str(payload, 'decision')}`,
        intro: `${str(payload, 'decidedBy')} decided on your change request in ${str(payload, 'projectName')}.`,
        facts: [{ label: 'Note', value: str(payload, 'note', 'No note was added.') }],
        action: {
          label: 'Open the request',
          path: `/projects/${str(payload, 'projectId')}/change-requests/${str(payload, 'changeRequestId')}`,
        },
      });

    case 'risk-assigned':
      return layout({
        heading: `You own risk ${str(payload, 'reference')}`,
        intro: `A risk in ${str(payload, 'projectName')} was assigned to you.`,
        facts: [
          { label: 'Risk', value: str(payload, 'title') },
          { label: 'Severity', value: str(payload, 'severity') },
        ],
        action: {
          label: 'Open the risk register',
          path: `/projects/${str(payload, 'projectId')}/risks`,
        },
      });

    case 'issue-assigned':
      return layout({
        heading: `You own issue ${str(payload, 'reference')}`,
        intro: `An issue in ${str(payload, 'projectName')} was assigned to you.`,
        facts: [
          { label: 'Issue', value: str(payload, 'title') },
          { label: 'Priority', value: str(payload, 'priority') },
        ],
        action: {
          label: 'Open the issue register',
          path: `/projects/${str(payload, 'projectId')}/issues`,
        },
      });

    case 'lead-overdue-digest':
      return layout({
        heading: `${str(payload, 'projectName')}: work needing attention`,
        intro: 'Here is what is outstanding in your project today.',
        bullets: list(payload, 'lines'),
        action: { label: 'Open the dashboard', path: `/projects/${str(payload, 'projectId')}` },
      });

    case 'daily-summary':
      return layout({
        heading: `Your day in Ekavist — ${str(payload, 'date')}`,
        intro: 'A summary of your work today.',
        bullets: list(payload, 'lines'),
        action: { label: 'Open my work', path: '/my-work' },
      });

    case 'weekly-summary':
      return layout({
        heading: `Weekly summary — ${str(payload, 'projectName')}`,
        intro: `Week of ${str(payload, 'weekStart')} to ${str(payload, 'weekEnd')}.`,
        bullets: list(payload, 'lines'),
        action: {
          label: 'Open the report',
          path: `/projects/${str(payload, 'projectId')}/reports`,
        },
      });

    default:
      return layout({
        heading: str(payload, 'title', 'Ekavist notification'),
        intro: str(payload, 'body', ''),
      });
  }
}
