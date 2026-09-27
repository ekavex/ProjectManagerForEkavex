/**
 * Development seed data (master prompt section 44).
 *
 * Everything created here is clearly marked as demonstration data: the organisation is
 * named "Ekavist (development)", project codes start with DEMO, and every account uses the
 * ekavist.test domain, which cannot receive real mail.
 *
 * The script refuses to run against a production database. Seeding is for development and
 * for the test fixtures, never for a live deployment.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { DEFAULT_PHASE_TEMPLATE, ORG_ROLE_PERMISSIONS, type OrgRole } from '@ekavist/shared';
import argon2 from 'argon2';
import { recomputeProjectProgress } from '../src/services/rollup.service.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'ekavist-demo-2026';

/** Index of the Execution phase in DEFAULT_PHASE_TEMPLATE; the demo's work lives there. */
const EXECUTION_PHASE = 4;
const TIMEZONE = 'Asia/Kolkata';

/** Dates are relative to today, so the seeded project always looks current. */
function shift(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function dateOnly(days: number): Date {
  return new Date(shift(days).toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to seed a production database. Seed data is for development only.');
  }

  const url = process.env['DATABASE_URL'] ?? '';
  if (/(^|[^a-z])prod/i.test(url)) {
    throw new Error(
      `DATABASE_URL looks like a production database (${url.replace(/:[^:@]+@/, ':***@')}). Refusing to seed.`,
    );
  }

  console.log('Seeding development data…\n');

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 3,
    parallelism: 1,
  });

  // --- organisation -------------------------------------------------------
  const organization = await prisma.organization.upsert({
    where: { id: 'demo-organization' },
    create: {
      id: 'demo-organization',
      name: 'Ekavist (development)',
      timezone: TIMEZONE,
      workdayStart: '09:30',
      lateAfter: '10:00',
    },
    update: {},
  });

  await prisma.rolePermission.createMany({
    data: (Object.keys(ORG_ROLE_PERMISSIONS) as OrgRole[]).flatMap((role) =>
      ORG_ROLE_PERMISSIONS[role].map((permission) => ({
        organizationId: organization.id,
        role,
        permission,
      })),
    ),
    skipDuplicates: true,
  });

  // --- departments --------------------------------------------------------
  const engineering = await upsertDepartment(organization.id, 'Engineering');
  const quality = await upsertDepartment(organization.id, 'Quality');

  // --- people -------------------------------------------------------------
  const admin = await upsertUser({
    organizationId: organization.id,
    email: 'admin@ekavist.test',
    fullName: 'Vishal Admin',
    role: 'SUPER_ADMIN',
    designation: 'Company Administrator',
    departmentId: engineering.id,
    passwordHash,
  });

  const lead = await upsertUser({
    organizationId: organization.id,
    email: 'lead@ekavist.test',
    fullName: 'Kunal Lead',
    role: 'PROJECT_LEAD',
    designation: 'Project Lead',
    departmentId: engineering.id,
    managerId: admin.id,
    passwordHash,
  });

  const members = await Promise.all([
    upsertUser({
      organizationId: organization.id,
      email: 'akshata@ekavist.test',
      fullName: 'Akshata Rao',
      role: 'TEAM_MEMBER',
      designation: 'Test Engineer',
      departmentId: quality.id,
      managerId: lead.id,
      passwordHash,
    }),
    upsertUser({
      organizationId: organization.id,
      email: 'rahul@ekavist.test',
      fullName: 'Rahul Nair',
      role: 'TEAM_MEMBER',
      designation: 'Embedded Engineer',
      departmentId: engineering.id,
      managerId: lead.id,
      passwordHash,
    }),
    upsertUser({
      organizationId: organization.id,
      email: 'priya@ekavist.test',
      fullName: 'Priya Desai',
      role: 'TEAM_MEMBER',
      designation: 'Software Engineer',
      departmentId: engineering.id,
      managerId: lead.id,
      passwordHash,
    }),
  ]);

  const viewer = await upsertUser({
    organizationId: organization.id,
    email: 'viewer@ekavist.test',
    fullName: 'Stakeholder Viewer',
    role: 'VIEWER',
    designation: 'Client Stakeholder',
    passwordHash,
  });

  // --- projects -----------------------------------------------------------
  const weeder = await seedProject({
    organizationId: organization.id,
    code: 'DEMO-WEEDER',
    name: 'AI-Based Electronic Weeder',
    description:
      'Demonstration project. Builds an autonomous weeding rig with vision-based weed detection.',
    leadId: lead.id,
    createdById: admin.id,
    departmentId: engineering.id,
    startDate: dateOnly(-40),
    plannedEndDate: dateOnly(50),
    members: [members[0], members[1], members[2]],
    viewerId: viewer.id,
  });

  const portal = await seedProject({
    organizationId: organization.id,
    code: 'DEMO-PORTAL',
    name: 'Customer Service Portal',
    description: 'Demonstration project. A self-service portal for warranty and support requests.',
    leadId: lead.id,
    createdById: admin.id,
    departmentId: engineering.id,
    startDate: dateOnly(-10),
    plannedEndDate: dateOnly(80),
    members: [members[2]],
    viewerId: null,
  });

  console.log('\nSeed complete.\n');
  console.log('  Sign in with any of these accounts:');
  console.log(`    admin@ekavist.test    (Super Admin)    password: ${DEMO_PASSWORD}`);
  console.log(`    lead@ekavist.test     (Project Lead)   password: ${DEMO_PASSWORD}`);
  console.log(`    rahul@ekavist.test    (Team Member)    password: ${DEMO_PASSWORD}`);
  console.log(`    viewer@ekavist.test   (Viewer)         password: ${DEMO_PASSWORD}`);
  console.log(`\n  Projects: ${weeder.code}, ${portal.code}`);
  console.log('\n  All of this is development data. Do not load it into a production database.\n');
}

async function upsertDepartment(organizationId: string, name: string) {
  return prisma.department.upsert({
    where: { organizationId_name: { organizationId, name } },
    create: { organizationId, name },
    update: {},
  });
}

async function upsertUser(input: {
  organizationId: string;
  email: string;
  fullName: string;
  role: OrgRole;
  designation: string;
  passwordHash: string;
  departmentId?: string;
  managerId?: string;
}) {
  return prisma.user.upsert({
    where: { organizationId_email: { organizationId: input.organizationId, email: input.email } },
    create: {
      organizationId: input.organizationId,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      designation: input.designation,
      passwordHash: input.passwordHash,
      departmentId: input.departmentId ?? null,
      managerId: input.managerId ?? null,
      timezone: TIMEZONE,
      joiningDate: dateOnly(-365),
      notificationPreference: { create: {} },
    },
    update: { passwordHash: input.passwordHash },
  });
}

interface SeedProjectInput {
  organizationId: string;
  code: string;
  name: string;
  description: string;
  leadId: string;
  createdById: string;
  departmentId: string;
  startDate: Date;
  plannedEndDate: Date;
  members: { id: string; fullName: string }[];
  viewerId: string | null;
}

async function seedProject(input: SeedProjectInput) {
  const existing = await prisma.project.findUnique({
    where: { organizationId_code: { organizationId: input.organizationId, code: input.code } },
    select: { id: true, code: true },
  });
  if (existing != null) {
    console.log(`  ${input.code} already exists; leaving it alone.`);
    return existing;
  }

  const project = await prisma.project.create({
    data: {
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      description: input.description,
      status: 'ACTIVE',
      priority: 'HIGH',
      startDate: input.startDate,
      plannedEndDate: input.plannedEndDate,
      actualStartDate: input.startDate,
      leadId: input.leadId,
      createdById: input.createdById,
      departmentId: input.departmentId,
      objectives: [
        'Deliver a working solution within the agreed schedule',
        'Keep the change log and decision log current',
      ],
      deliverables: ['Working prototype', 'Test report', 'Handover documentation'],
      members: {
        create: [
          { userId: input.leadId, projectRole: 'LEAD', canReadChat: true },
          ...input.members.map((member) => ({
            userId: member.id,
            projectRole: 'MEMBER' as const,
            canReadChat: true,
          })),
          ...(input.viewerId != null
            ? [{ userId: input.viewerId, projectRole: 'VIEWER' as const, canReadChat: true }]
            : []),
        ],
      },
      phases: {
        create: DEFAULT_PHASE_TEMPLATE.map((phase, index) => ({
          sequence: index + 1,
          name: phase.name,
          description: phase.description,
          // A rough plan: the first phases are behind us, the later ones ahead.
          plannedStart: dateOnly(-40 + index * 12),
          plannedEnd: dateOnly(-40 + (index + 1) * 12 - 1),
          // Phases 1 to 4 are behind us, Execution is in flight, the rest are ahead.
          status:
            index < EXECUTION_PHASE
              ? 'COMPLETED'
              : index === EXECUTION_PHASE
                ? 'IN_PROGRESS'
                : 'NOT_STARTED',
          // The Requirements gate is on, so the demo shows a real phase gate.
          approvalRequired: index === 1,
          gateStatus: index === 1 ? 'APPROVED' : 'NOT_REQUIRED',
          approverId: index === 1 ? input.createdById : null,
          ownerId: input.leadId,
        })),
      },
    },
    select: {
      id: true,
      code: true,
      phases: { orderBy: { sequence: 'asc' }, select: { id: true } },
    },
  });

  const phaseIds = project.phases.map((phase) => phase.id);

  // --- WBS ----------------------------------------------------------------
  const wbsRoot = await prisma.wbsItem.create({
    data: {
      projectId: project.id,
      phaseId: phaseIds[EXECUTION_PHASE] as string,
      code: '1.0',
      position: 0,
      depth: 0,
      name: 'Execution',
      ownerId: input.leadId,
      plannedStart: dateOnly(-16),
      plannedEnd: dateOnly(20),
    },
    select: { id: true },
  });

  const wbsChildren = await Promise.all(
    ['Development', 'Integration', 'Internal Testing'].map((name, index) =>
      prisma.wbsItem.create({
        data: {
          projectId: project.id,
          phaseId: phaseIds[EXECUTION_PHASE] as string,
          parentId: wbsRoot.id,
          code: `1.${index + 1}`,
          position: index,
          depth: 1,
          name,
          ownerId: input.members[index % input.members.length]?.id ?? input.leadId,
        },
        select: { id: true },
      }),
    ),
  );

  // --- tasks --------------------------------------------------------------
  const taskSpecs: {
    name: string;
    wbsIndex: number;
    assignee: number;
    offsetStart: number;
    offsetDue: number;
    status: Prisma.TaskCreateInput['status'];
    progress: number;
    hours: number;
  }[] = [
    {
      name: 'Vision model training set',
      wbsIndex: 0,
      assignee: 0,
      offsetStart: -16,
      offsetDue: -6,
      status: 'COMPLETED',
      progress: 100,
      hours: 24,
    },
    {
      name: 'Motor control firmware',
      wbsIndex: 0,
      assignee: 1,
      offsetStart: -12,
      offsetDue: -2,
      status: 'COMPLETED',
      progress: 100,
      hours: 32,
    },
    {
      name: 'Weed detection accuracy tuning',
      wbsIndex: 0,
      assignee: 2,
      offsetStart: -5,
      offsetDue: 6,
      status: 'IN_PROGRESS',
      progress: 45,
      hours: 40,
    },
    {
      name: 'Chassis and sensor integration',
      wbsIndex: 1,
      assignee: 1,
      offsetStart: -3,
      offsetDue: 9,
      status: 'IN_PROGRESS',
      progress: 20,
      hours: 36,
    },
    {
      name: 'Field trial harness',
      wbsIndex: 1,
      assignee: 0,
      offsetStart: 4,
      offsetDue: 16,
      status: 'NOT_STARTED',
      progress: 0,
      hours: 20,
    },
    {
      name: 'Regression test suite',
      wbsIndex: 2,
      assignee: 0,
      offsetStart: -2,
      offsetDue: -1,
      status: 'BLOCKED',
      progress: 30,
      hours: 28,
    },
    {
      name: 'Power draw measurement',
      wbsIndex: 2,
      assignee: 1,
      offsetStart: 6,
      offsetDue: 18,
      status: 'NOT_STARTED',
      progress: 0,
      hours: 12,
    },
  ];

  const tasks: { id: string; reference: string }[] = [];
  for (const [index, spec] of taskSpecs.entries()) {
    const assignee = input.members[spec.assignee % input.members.length] ?? { id: input.leadId };
    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        phaseId: phaseIds[EXECUTION_PHASE] as string,
        wbsItemId: wbsChildren[spec.wbsIndex]?.id ?? null,
        reference: `T-${index + 1}`,
        name: spec.name,
        status: spec.status,
        priority: index % 3 === 0 ? 'HIGH' : 'MEDIUM',
        progress: spec.progress,
        startDate: dateOnly(spec.offsetStart),
        dueDate: dateOnly(spec.offsetDue),
        estimatedHours: spec.hours,
        actualHours: spec.status === 'COMPLETED' ? spec.hours : Math.round(spec.hours * 0.4),
        completedAt: spec.status === 'COMPLETED' ? shift(spec.offsetDue) : null,
        accountableId: input.leadId,
        createdById: input.leadId,
        assignments: { create: { userId: assignee.id, isPrimary: true } },
      },
      select: { id: true, reference: true },
    });
    tasks.push(task);
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { taskCounter: tasks.length },
  });

  // --- dependencies (a simple Finish-to-Start chain) ----------------------
  for (let index = 0; index < 3; index += 1) {
    const predecessor = tasks[index];
    const successor = tasks[index + 1];
    if (predecessor == null || successor == null) continue;
    await prisma.taskDependency.create({
      data: {
        projectId: project.id,
        predecessorId: predecessor.id,
        successorId: successor.id,
        type: 'FINISH_TO_START',
      },
    });
  }

  // --- milestones ---------------------------------------------------------
  await prisma.milestone.createMany({
    data: [
      {
        projectId: project.id,
        phaseId: phaseIds[1] as string,
        name: 'Requirements approved',
        date: dateOnly(-18),
        status: 'ACHIEVED',
        ownerId: input.leadId,
      },
      {
        projectId: project.id,
        phaseId: phaseIds[EXECUTION_PHASE] as string,
        name: 'Prototype field trial',
        date: dateOnly(18),
        status: 'PLANNED',
        ownerId: input.leadId,
      },
    ],
  });

  // --- chat ---------------------------------------------------------------
  const opening = await prisma.message.create({
    data: {
      projectId: project.id,
      authorId: input.leadId,
      body: 'Kickoff notes and the approved requirements are in the project documents. Shout if anything is unclear.',
    },
    select: { id: true },
  });
  await prisma.pinnedMessage.create({
    data: { messageId: opening.id, pinnedById: input.leadId },
  });
  await prisma.message.create({
    data: {
      projectId: project.id,
      authorId: input.members[0]?.id ?? input.leadId,
      body: 'Sharing the detection accuracy spreadsheet from this week.',
      attachments: {
        create: {
          kind: 'GOOGLE_DRIVE',
          name: 'Detection accuracy — week 3',
          url: 'https://drive.google.com/file/d/demo-accuracy/view',
        },
      },
    },
  });

  // --- documents ----------------------------------------------------------
  await prisma.document.createMany({
    data: [
      {
        projectId: project.id,
        phaseId: phaseIds[1] as string,
        name: 'Approved requirements',
        category: 'REQUIREMENTS',
        kind: 'GOOGLE_DRIVE',
        url: 'https://drive.google.com/file/d/demo-requirements/view',
        addedById: input.leadId,
      },
      {
        projectId: project.id,
        phaseId: phaseIds[3] as string,
        name: 'System design',
        category: 'DESIGN',
        kind: 'GOOGLE_DRIVE',
        url: 'https://drive.google.com/file/d/demo-design/view',
        addedById: input.leadId,
      },
    ],
  });

  // --- notes and decisions -------------------------------------------------
  await prisma.projectNote.create({
    data: {
      projectId: project.id,
      authorId: input.leadId,
      title: 'Weekly sync',
      body: 'Mondays at 10:00. Agenda: progress, blockers, next week.',
      pinned: true,
    },
  });
  await prisma.decisionLog.create({
    data: {
      projectId: project.id,
      phaseId: phaseIds[1] as string,
      reference: 'D-1',
      title: 'Use a monocular camera rather than stereo',
      description: 'Stereo added cost without a measurable accuracy gain in the trial.',
      reason: 'Cost and complexity outweighed the accuracy benefit.',
      decidedOn: dateOnly(-20),
      decisionMakerId: input.leadId,
    },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { decisionCounter: 1 },
  });

  // --- risks and issues ---------------------------------------------------
  await prisma.risk.create({
    data: {
      projectId: project.id,
      reference: 'R-1',
      title: 'Monsoon may delay field trials',
      description: 'Field trials need dry conditions for three consecutive days.',
      probability: 'HIGH',
      impact: 'HIGH',
      severity: 'HIGH',
      severityScore: 9,
      ownerId: input.leadId,
      mitigation: 'Book two alternative trial windows.',
      contingency: 'Run the trial at the covered test track.',
      status: 'MONITORING',
      dueDate: dateOnly(14),
    },
  });
  await prisma.issue.create({
    data: {
      projectId: project.id,
      reference: 'I-1',
      title: 'Test rig power supply is unreliable',
      description: 'The bench supply trips under load, blocking the regression suite.',
      priority: 'HIGH',
      ownerId: input.members[0]?.id ?? input.leadId,
      identifiedOn: dateOnly(-3),
      targetResolution: dateOnly(4),
      status: 'IN_PROGRESS',
    },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { riskCounter: 1, issueCounter: 1 },
  });

  // --- activity -----------------------------------------------------------
  await prisma.activityLog.createMany({
    data: [
      {
        projectId: project.id,
        actorId: input.createdById,
        verb: 'created',
        summary: 'Vishal Admin created the project',
        entityType: 'Project',
        entityId: project.id,
      },
      {
        projectId: project.id,
        actorId: input.leadId,
        verb: 'approved',
        summary: 'Kunal Lead approved the Requirements phase',
        entityType: 'Phase',
        entityId: phaseIds[1] as string,
      },
    ],
  });

  // Derived progress on WBS items, phases and the project is a cache written by the
  // rollup service. Seeding rows directly bypasses it, so it is refreshed here — otherwise
  // the demo would show 0% against finished tasks, which is exactly the kind of fake
  // number this project is not allowed to display.
  await recomputeProjectProgress(prisma, project.id);

  console.log(`  ${project.code} created with ${tasks.length} tasks.`);
  return project;
}

main()
  .catch((error: unknown) => {
    console.error('\nSeeding failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
