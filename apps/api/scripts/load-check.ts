/**
 * The Phase 19 load check.
 *
 * Builds a project far larger than anything this company will run — thousands of tasks,
 * a chat history in the tens of thousands, a resource library in the thousands — and then
 * times the reads that would be the first to fall over: the chat page, chat search, the
 * resource library (including a deep page), the Gantt feed, the task list and the project
 * dashboard.
 *
 * It goes through the HTTP layer rather than calling services directly, so the numbers
 * include serialisation, permission resolution and the mapping layer, which is what a
 * person actually waits for.
 *
 *   npm run load:check --workspace @ekavist/api
 *
 * It refuses to run against DATABASE_URL, because it truncates every table it seeds into.
 * Point LOAD_DATABASE_URL at a scratch database (TEST_DATABASE_URL will do).
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
loadDotenv({ path: path.join(repoRoot, '.env') });

const SCALE = {
  tasks: Number(process.env['LOAD_TASKS'] ?? 4000),
  messages: Number(process.env['LOAD_MESSAGES'] ?? 20000),
  documents: Number(process.env['LOAD_DOCUMENTS'] ?? 2000),
  taskAttachments: Number(process.env['LOAD_TASK_ATTACHMENTS'] ?? 2000),
  chatAttachments: Number(process.env['LOAD_CHAT_ATTACHMENTS'] ?? 2000),
  wbsItems: Number(process.env['LOAD_WBS_ITEMS'] ?? 400),
};

/** How long a read may take before the check reports it as a failure, in milliseconds. */
const BUDGET_MS = Number(process.env['LOAD_BUDGET_MS'] ?? 1500);

function resolveUrl(): string {
  const url = process.env['LOAD_DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
  if (url == null || url === '') {
    throw new Error('Set LOAD_DATABASE_URL (or TEST_DATABASE_URL) to a scratch database.');
  }
  if (url === process.env['DATABASE_URL']) {
    throw new Error(
      'The load check truncates every table it touches and must not point at DATABASE_URL.',
    );
  }
  return url;
}

const databaseUrl = resolveUrl();
process.env['DATABASE_URL'] = databaseUrl;
process.env['NODE_ENV'] = 'test';

// Imported after DATABASE_URL is rewritten: the modules below read it at load time.
const { createApp } = await import('../src/http/app.js');
const { hashPassword } = await import('../src/lib/password.js');
const { ORG_ROLE_PERMISSIONS, PERMISSIONS } = await import('@ekavist/shared');
const supertest = (await import('supertest')).default;

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function truncate(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const names = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

interface Seeded {
  projectId: string;
  email: string;
  password: string;
}

async function seed(): Promise<Seeded> {
  const password = 'load-check-password';

  const org = await db.organization.create({
    data: {
      name: 'Load Check',
      timezone: 'Asia/Kolkata',
      workdayStart: '09:30',
      lateAfter: '10:00',
    },
  });

  await db.rolePermission.createMany({
    data: (Object.keys(ORG_ROLE_PERMISSIONS) as (keyof typeof ORG_ROLE_PERMISSIONS)[]).flatMap(
      (role) =>
        role === 'SUPER_ADMIN'
          ? PERMISSIONS.map((permission) => ({ organizationId: org.id, role, permission }))
          : ORG_ROLE_PERMISSIONS[role].map((permission) => ({
              organizationId: org.id,
              role,
              permission,
            })),
    ),
  });

  const admin = await db.user.create({
    data: {
      organizationId: org.id,
      fullName: 'Load Check Admin',
      email: 'load-check@ekavist.test',
      passwordHash: await hashPassword(password),
      role: 'SUPER_ADMIN',
      timezone: 'Asia/Kolkata',
      notificationPreference: { create: {} },
    },
  });

  const project = await db.project.create({
    data: {
      organizationId: org.id,
      code: 'LOAD-01',
      name: 'Load Check Project',
      status: 'ACTIVE',
      leadId: admin.id,
      startDate: new Date('2026-01-01'),
      plannedEndDate: new Date('2026-12-31'),
    },
  });

  await db.projectMember.create({
    data: { projectId: project.id, userId: admin.id, projectRole: 'LEAD' },
  });

  const phaseNames = [
    'Initiation',
    'Requirements',
    'Design',
    'Development',
    'Testing',
    'Deployment',
    'Handover',
    'Closure',
  ];
  await db.phase.createMany({
    data: phaseNames.map((name, index) => ({
      projectId: project.id,
      sequence: index + 1,
      name,
      plannedStart: new Date(2026, index, 1),
      plannedEnd: new Date(2026, index + 1, 0),
    })),
  });
  const phases = await db.phase.findMany({
    where: { projectId: project.id },
    orderBy: { sequence: 'asc' },
    select: { id: true },
  });

  // A two-level WBS, so the Gantt has rollup bars to draw as well as task bars.
  await db.wbsItem.createMany({
    data: Array.from({ length: SCALE.wbsItems }, (_, index) => ({
      projectId: project.id,
      phaseId: phases[index % phases.length]?.id,
      code: `${index + 1}.0`,
      position: index,
      depth: 0,
      name: `Work package ${index + 1}`,
    })),
  });
  const wbsItems = await db.wbsItem.findMany({
    where: { projectId: project.id },
    select: { id: true },
  });

  await inBatches(SCALE.tasks, 1000, (offset, size) =>
    db.task.createMany({
      data: Array.from({ length: size }, (_, i) => {
        const index = offset + i;
        return {
          projectId: project.id,
          phaseId: phases[index % phases.length]?.id,
          wbsItemId: wbsItems[index % wbsItems.length]?.id,
          reference: `T-${index + 1}`,
          name: `Task ${index + 1}: fabricate the bracket`,
          status: index % 3 === 0 ? ('COMPLETED' as const) : ('IN_PROGRESS' as const),
          progress: index % 3 === 0 ? 100 : 40,
          startDate: new Date(2026, index % 12, 1),
          dueDate: new Date(2026, index % 12, 20),
          estimatedHours: 8,
          createdById: admin.id,
        };
      }),
    }),
  );
  const taskIds = (
    await db.task.findMany({ where: { projectId: project.id }, select: { id: true } })
  ).map((row) => row.id);

  await inBatches(SCALE.messages, 2000, (offset, size) =>
    db.message.createMany({
      data: Array.from({ length: size }, (_, i) => {
        const index = offset + i;
        return {
          projectId: project.id,
          authorId: admin.id,
          body:
            index % 50 === 0
              ? `Calibration note ${index}: the encoder drifted again.`
              : `Progress update ${index} on the bracket assembly.`,
          createdAt: new Date(Date.now() - (SCALE.messages - index) * 60_000),
        };
      }),
    }),
  );
  const messageIds = (
    await db.message.findMany({
      where: { projectId: project.id },
      select: { id: true },
      take: SCALE.chatAttachments,
    })
  ).map((row) => row.id);

  await inBatches(SCALE.chatAttachments, 1000, (offset, size) =>
    db.messageAttachment.createMany({
      data: Array.from({ length: size }, (_, i) => ({
        messageId: messageIds[(offset + i) % messageIds.length] as string,
        kind: 'LINK' as const,
        name: `Chat file ${offset + i}.pdf`,
        url: `https://example.com/chat/${offset + i}.pdf`,
      })),
    }),
  );

  await inBatches(SCALE.taskAttachments, 1000, (offset, size) =>
    db.taskAttachment.createMany({
      data: Array.from({ length: size }, (_, i) => ({
        taskId: taskIds[(offset + i) % taskIds.length] as string,
        kind: 'LINK' as const,
        name: `Task file ${offset + i}.png`,
        url: `https://example.com/task/${offset + i}.png`,
        addedById: admin.id,
      })),
    }),
  );

  await inBatches(SCALE.documents, 1000, (offset, size) =>
    db.document.createMany({
      data: Array.from({ length: size }, (_, i) => ({
        projectId: project.id,
        phaseId: phases[(offset + i) % phases.length]?.id,
        name: `Document ${offset + i}`,
        url: `https://example.com/doc/${offset + i}.pdf`,
        addedById: admin.id,
      })),
    }),
  );

  return { projectId: project.id, email: admin.email, password };
}

async function inBatches(
  total: number,
  size: number,
  run: (offset: number, size: number) => Promise<unknown>,
): Promise<void> {
  for (let offset = 0; offset < total; offset += size) {
    await run(offset, Math.min(size, total - offset));
  }
}

interface Measurement {
  what: string;
  rows: number | string;
  best: number;
  median: number;
  worst: number;
  withinBudget: boolean;
}

async function main(): Promise<void> {
  console.log(`Load check against ${databaseUrl.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`Scale: ${JSON.stringify(SCALE)}\n`);

  await truncate();

  const seedStarted = performance.now();
  const seeded = await seed();
  console.log(`Seeded in ${Math.round(performance.now() - seedStarted)} ms\n`);

  const agent = supertest.agent(createApp());
  const login = await agent
    .post('/api/v1/auth/login')
    .send({ email: seeded.email, password: seeded.password });
  if (login.status !== 200) {
    throw new Error(`Could not sign in: ${login.status} ${JSON.stringify(login.body)}`);
  }
  const token = (login.body as { accessToken: string }).accessToken;
  const base = `/api/v1/projects/${seeded.projectId}`;

  const reads: { what: string; path: string }[] = [
    { what: 'chat: newest page', path: `${base}/messages?page=1&pageSize=50` },
    { what: 'chat: page 20', path: `${base}/messages?page=20&pageSize=50` },
    { what: 'chat: search', path: `${base}/messages?search=calibration` },
    { what: 'resources: first page', path: `${base}/resources?page=1&pageSize=25` },
    { what: 'resources: page 100', path: `${base}/resources?page=100&pageSize=25` },
    { what: 'resources: search', path: `${base}/resources?search=Task%20file%201` },
    { what: 'gantt feed', path: `${base}/gantt` },
    { what: 'task list', path: `${base}/tasks?page=1&pageSize=50` },
    { what: 'project dashboard', path: `${base}/dashboard` },
  ];

  const results: Measurement[] = [];

  for (const read of reads) {
    const samples: number[] = [];
    let rows: number | string = '—';
    let status = 0;

    // Five samples: the first pays for a cold plan cache, the rest are what a warm server
    // actually does.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      const response = await agent.get(read.path).set('Authorization', `Bearer ${token}`);
      samples.push(performance.now() - started);
      status = response.status;

      const body = response.body as { data?: unknown[]; tasks?: unknown[] };
      if (Array.isArray(body.data)) rows = body.data.length;
      else if (Array.isArray(body.tasks)) rows = body.tasks.length;
    }

    if (status !== 200) {
      console.error(`  ${read.what}: HTTP ${status} — ${read.path}`);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    results.push({
      what: read.what,
      rows,
      best: Math.round(sorted[0] as number),
      median: Math.round(median),
      worst: Math.round(sorted[sorted.length - 1] as number),
      withinBudget: status === 200 && median <= BUDGET_MS,
    });
  }

  console.log(
    `| Read                    | Rows | Best | Median | Worst | Within ${BUDGET_MS} ms |`,
  );
  console.log('| ----------------------- | ---: | ---: | -----: | ----: | :----------- |');
  for (const result of results) {
    console.log(
      `| ${result.what.padEnd(23)} | ${String(result.rows).padStart(4)} | ${String(result.best).padStart(4)} | ${String(result.median).padStart(6)} | ${String(result.worst).padStart(5)} | ${result.withinBudget ? 'yes' : 'NO'} |`,
    );
  }

  const failures = results.filter((result) => !result.withinBudget);
  console.log('');
  if (failures.length > 0) {
    console.error(`${failures.length} read(s) exceeded the budget.`);
    process.exitCode = 1;
  } else {
    console.log('Every read is within budget.');
  }
}

try {
  await main();
} finally {
  await db.$disconnect();
}
