import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, errorCode } from '../helpers/api.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createTask, seedProjectWorld, type ProjectWorld } from '../helpers/world.js';

describe('waterfall phases and gates', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('reports every phase as startable when no gate is configured', async () => {
    const world = await seedProjectWorld();
    const response = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/phases`),
    );

    expect(response.body.data.every((phase: { canStart: boolean }) => phase.canStart)).toBe(true);
  });

  it('blocks a later phase until an earlier gate is approved', async () => {
    const world = await seedProjectWorld();
    const [initiation, requirements] = world.phaseIds;

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/phases/${initiation}`)
        .send({ approvalRequired: true }),
    );

    const blocked = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/phases/${requirements}/start`),
    );
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked.body)).toBe('PHASE_GATE_BLOCKED');
    expect(blocked.body.error.message).toContain('Initiation');

    // The approver here is the admin: the lead submitted it, so it escalates (D-008).
    await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/phases/${initiation}/submit`)
        .send({ note: 'Charter signed' }),
    );
    const approved = await world.sessions.admin.auth(
      api().post(`/api/v1/projects/${world.project.id}/phases/${initiation}/approve`).send({}),
    );
    expect(approved.status).toBe(200);
    expect(approved.body.gate.status).toBe('APPROVED');

    const started = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/phases/${requirements}/start`),
    );
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');
  });

  it('refuses to let the submitter approve their own gate', async () => {
    const world = await seedProjectWorld();
    const [initiation] = world.phaseIds;

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/phases/${initiation}`)
        .send({ approvalRequired: true, approverId: world.lead.id }),
    );
    await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/phases/${initiation}/submit`).send({}),
    );

    const response = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/phases/${initiation}/approve`).send({}),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('PHASE_APPROVER_IS_SUBMITTER');
  });

  it('sends a rejected phase back for rework', async () => {
    const world = await seedProjectWorld();
    const [initiation] = world.phaseIds;

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/phases/${initiation}`)
        .send({ approvalRequired: true }),
    );
    await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/phases/${initiation}/submit`).send({}),
    );

    const rejected = await world.sessions.admin.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/phases/${initiation}/reject`)
        .send({ note: 'The charter is missing a budget', requiresRework: true }),
    );

    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REWORK_REQUIRED');
    expect(rejected.body.gate.status).toBe('REJECTED');
    expect(rejected.body.gate.decisionNote).toContain('budget');
  });

  it('refuses a decision on a phase that was never submitted', async () => {
    const world = await seedProjectWorld();
    const response = await world.sessions.admin.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/phases/${world.phaseIds[0]}/approve`)
        .send({}),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('PHASE_NOT_SUBMITTED');
  });

  it('does not let a member change a phase', async () => {
    const world = await seedProjectWorld();
    const response = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/phases/${world.phaseIds[0]}`)
        .send({ name: 'Renamed' }),
    );
    expect(response.status).toBe(403);
  });
});

describe('work breakdown structure', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('numbers roots 1.0, 2.0 and children 1.1, 1.2', async () => {
    const world = await seedProjectWorld();
    const project = world.project.id;

    const first = await addWbs(world, { name: 'Initiation', phaseId: world.phaseIds[0] });
    await addWbs(world, { name: 'Planning', phaseId: world.phaseIds[2] });
    await addWbs(world, { name: 'Project Charter', parentId: rootId(first, 'Initiation') });
    const tree = await addWbs(world, {
      name: 'Stakeholder Identification',
      parentId: rootId(first, 'Initiation'),
    });

    const codes = flatten(tree).map((node) => `${node.code} ${node.name}`);
    expect(codes).toContain('1.0 Initiation');
    expect(codes).toContain('2.0 Planning');
    expect(codes).toContain('1.1 Project Charter');
    expect(codes).toContain('1.2 Stakeholder Identification');

    const fetched = await world.sessions.lead.auth(api().get(`/api/v1/projects/${project}/wbs`));
    expect(flatten(fetched.body.data)).toHaveLength(4);
  });

  it('renumbers after a move', async () => {
    const world = await seedProjectWorld();
    let tree = await addWbs(world, { name: 'Alpha' });
    tree = await addWbs(world, { name: 'Beta' });

    const beta = flatten(tree).find((node) => node.name === 'Beta');
    const moved = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/wbs/${beta?.id}/move`)
        .send({ parentId: null, position: 0 }),
    );

    const codes = flatten(moved.body.data).map((node) => `${node.code} ${node.name}`);
    expect(codes).toContain('1.0 Beta');
    expect(codes).toContain('2.0 Alpha');
  });

  it('refuses to move an item underneath its own child', async () => {
    const world = await seedProjectWorld();
    let tree = await addWbs(world, { name: 'Parent' });
    const parent = flatten(tree).find((node) => node.name === 'Parent');
    tree = await addWbs(world, { name: 'Child', parentId: parent?.id });
    const child = flatten(tree).find((node) => node.name === 'Child');

    const response = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/wbs/${parent?.id}/move`)
        .send({ parentId: child?.id, position: 0 }),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('WBS_CYCLE');
  });

  it('keeps a task when its WBS item is deleted', async () => {
    const world = await seedProjectWorld();
    const tree = await addWbs(world, { name: 'Research', phaseId: world.phaseIds[1] });
    const node = flatten(tree)[0];
    const task = await createTask(world, { wbsItemId: node?.id, phaseId: undefined });

    await world.sessions.lead.auth(
      api().delete(`/api/v1/projects/${world.project.id}/wbs/${node?.id}`),
    );

    const after = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/tasks/${task.id}`),
    );
    expect(after.status).toBe(200);
    expect(after.body.wbs).toBeNull();
  });
});

describe('tasks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('gives each task a project-scoped reference', async () => {
    const world = await seedProjectWorld();
    const first = await createTask(world, { name: 'One' });
    const second = await createTask(world, { name: 'Two' });

    expect(first.reference).toBe('T-1');
    expect(second.reference).toBe('T-2');
  });

  it('refuses to assign someone who is not on the project', async () => {
    const world = await seedProjectWorld();

    const response = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/tasks`)
        .send({ name: 'Stranger work', assigneeIds: [world.outsider.id] }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('on the project');
  });

  it('lets an assignee update their own progress', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const response = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/progress`)
        .send({ progress: 50 }),
    );

    expect(response.status).toBe(200);
    expect(response.body.progress).toBe(50);
    expect(response.body.status).toBe('IN_PROGRESS');
  });

  it('stops a member updating a task that is not theirs', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const response = await world.sessions.otherMember.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/progress`)
        .send({ progress: 90 }),
    );

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('TASK_NOT_ASSIGNED_TO_YOU');
  });

  it('forces a completed task to 100 per cent', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const response = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'COMPLETED' }),
    );

    expect(response.body.progress).toBe(100);
    expect(response.body.completedAt).not.toBeNull();
  });

  it('completes a task dragged to 100 per cent', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const response = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/progress`)
        .send({ progress: 100 }),
    );

    expect(response.body.status).toBe('COMPLETED');
  });

  it('does not let a member cancel a task', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const response = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'CANCELLED' }),
    );

    expect(response.status).toBe(403);
  });

  it('refuses to reopen a cancelled task', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'CANCELLED' }),
    );
    const response = await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'IN_PROGRESS' }),
    );

    expect(response.status).toBe(422);
    expect(errorCode(response.body)).toBe('TASK_STATUS_TRANSITION_INVALID');
  });

  it('flags an overdue task and filters on it', async () => {
    const world = await seedProjectWorld();
    await createTask(world, { name: 'Late work', dueDate: '2020-01-01', startDate: undefined });

    const list = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/tasks?overdueOnly=true`),
    );

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].isOverdue).toBe(true);
    expect(list.body.data[0].daysUntilDue).toBeLessThan(0);
  });

  it('rolls task progress up into the phase and the project', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world, { estimatedHours: 10 });

    await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'COMPLETED' }),
    );

    const phases = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/phases`),
    );
    const requirements = phases.body.data.find(
      (phase: { id: string }) => phase.id === world.phaseIds[1],
    );
    expect(requirements.progress).toBe(100);

    const project = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}`),
    );
    // One of eight phases is finished, weighted equally because none has planned dates.
    expect(project.body.progress).toBeGreaterThan(0);
    expect(project.body.progress).toBeLessThan(100);
  });

  it('starts the phase when the first task in it starts', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/status`)
        .send({ status: 'IN_PROGRESS' }),
    );

    const phases = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/phases`),
    );
    const requirements = phases.body.data.find(
      (phase: { id: string }) => phase.id === world.phaseIds[1],
    );
    expect(requirements.status).toBe('IN_PROGRESS');
    expect(requirements.actualStart).not.toBeNull();
  });

  it('keeps a viewer out of every write', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const create = await world.sessions.viewer.auth(
      api().post(`/api/v1/projects/${world.project.id}/tasks`).send({ name: 'Nope' }),
    );
    const update = await world.sessions.viewer.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}/progress`)
        .send({ progress: 10 }),
    );
    const read = await world.sessions.viewer.auth(
      api().get(`/api/v1/projects/${world.project.id}/tasks`),
    );

    expect(create.status).toBe(403);
    expect(update.status).toBe(403);
    expect(read.status).toBe(200);
  });
});

describe('task dependencies', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('warns before starting a task whose predecessor is unfinished, and allows an override', async () => {
    const world = await seedProjectWorld();
    const first = await createTask(world, { name: 'Requirements' });
    const second = await createTask(world, { name: 'Architecture' });

    await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/dependencies`)
        .send({ predecessorId: first.id, successorId: second.id }),
    );

    const warned = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${second.id}/status`)
        .send({ status: 'IN_PROGRESS' }),
    );
    expect(warned.status).toBe(422);
    expect(errorCode(warned.body)).toBe('TASK_PREDECESSOR_INCOMPLETE');
    expect(warned.body.error.message).toContain('T-1');

    const forced = await world.sessions.member.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${second.id}/status`)
        .send({ status: 'IN_PROGRESS', overridePredecessorWarning: true }),
    );
    expect(forced.status).toBe(200);
  });

  it('rejects a cycle and names the tasks involved', async () => {
    const world = await seedProjectWorld();
    const a = await createTask(world, { name: 'A' });
    const b = await createTask(world, { name: 'B' });
    const c = await createTask(world, { name: 'C' });

    for (const [from, to] of [
      [a, b],
      [b, c],
    ] as const) {
      const link = await world.sessions.lead.auth(
        api()
          .post(`/api/v1/projects/${world.project.id}/dependencies`)
          .send({ predecessorId: from.id, successorId: to.id }),
      );
      expect(link.status).toBe(201);
    }

    const cycle = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/dependencies`)
        .send({ predecessorId: c.id, successorId: a.id }),
    );

    expect(cycle.status).toBe(422);
    expect(errorCode(cycle.body)).toBe('TASK_DEPENDENCY_CYCLE');
    expect(cycle.body.error.message).toContain('T-1');
    expect(cycle.body.error.message).toContain('T-3');
  });

  it('rejects a self-dependency', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world);

    const response = await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/dependencies`)
        .send({ predecessorId: task.id, successorId: task.id }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects the same dependency twice', async () => {
    const world = await seedProjectWorld();
    const a = await createTask(world, { name: 'A' });
    const b = await createTask(world, { name: 'B' });

    const payload = { predecessorId: a.id, successorId: b.id };
    await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/dependencies`).send(payload),
    );
    const again = await world.sessions.lead.auth(
      api().post(`/api/v1/projects/${world.project.id}/dependencies`).send(payload),
    );

    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe('TASK_DEPENDENCY_DUPLICATE');
  });
});

describe('gantt', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns live bars with the hierarchy and the dependency edges', async () => {
    const world = await seedProjectWorld();
    const tree = await addWbs(world, { name: 'Requirements', phaseId: world.phaseIds[1] });
    const wbsId = flatten(tree)[0]?.id;

    const first = await createTask(world, {
      name: 'Interviews',
      wbsItemId: wbsId,
      phaseId: undefined,
      startDate: '2026-09-05',
      dueDate: '2026-09-10',
    });
    const second = await createTask(world, {
      name: 'Write the spec',
      wbsItemId: wbsId,
      phaseId: undefined,
      startDate: '2026-09-11',
      dueDate: '2026-09-18',
    });
    await world.sessions.lead.auth(
      api()
        .post(`/api/v1/projects/${world.project.id}/dependencies`)
        .send({ predecessorId: first.id, successorId: second.id }),
    );

    const gantt = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/gantt`),
    );

    expect(gantt.status).toBe(200);
    const bars = gantt.body.bars as {
      id: string;
      kind: string;
      label: string;
      depth: number;
      start: string | null;
      end: string | null;
    }[];

    const phaseBar = bars.find((bar) => bar.kind === 'PHASE' && bar.label === 'Requirements');
    const wbsBar = bars.find((bar) => bar.kind === 'WBS');
    const taskBar = bars.find((bar) => bar.label === 'Interviews');

    expect(phaseBar).toBeDefined();
    expect(wbsBar?.depth).toBe(1);
    expect(taskBar?.depth).toBe(2);
    // The parent spans its children even though it has no dates of its own.
    expect(wbsBar?.start).toBe('2026-09-05');
    expect(wbsBar?.end).toBe('2026-09-18');
    expect(gantt.body.dependencies).toHaveLength(1);
    expect(gantt.body.dependencies[0].fromId).toBe(first.id);
  });

  it('reflects a date change immediately', async () => {
    const world = await seedProjectWorld();
    const task = await createTask(world, { startDate: '2026-09-05', dueDate: '2026-09-10' });

    await world.sessions.lead.auth(
      api()
        .patch(`/api/v1/projects/${world.project.id}/tasks/${task.id}`)
        .send({ dueDate: '2026-09-25' }),
    );

    const gantt = await world.sessions.lead.auth(
      api().get(`/api/v1/projects/${world.project.id}/gantt`),
    );
    const bar = (gantt.body.bars as { id: string; end: string }[]).find(
      (candidate) => candidate.id === task.id,
    );
    expect(bar?.end).toBe('2026-09-25');
  });
});

// ------------------------------------------------------------------ helpers

interface TreeNode {
  id: string;
  code: string;
  name: string;
  children: TreeNode[];
}

async function addWbs(world: ProjectWorld, payload: Record<string, unknown>): Promise<TreeNode[]> {
  const response = await world.sessions.lead.auth(
    api().post(`/api/v1/projects/${world.project.id}/wbs`).send(payload),
  );
  if (response.status !== 201) {
    throw new Error(`Could not create the WBS item: ${JSON.stringify(response.body)}`);
  }
  return response.body.data as TreeNode[];
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function rootId(tree: TreeNode[], name: string): string {
  const node = flatten(tree).find((candidate) => candidate.name === name);
  if (node == null) throw new Error(`No WBS item named ${name}`);
  return node.id;
}
