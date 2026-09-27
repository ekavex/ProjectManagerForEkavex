/**
 * Task dependency graph rules.
 *
 * The important one: a dependency graph must stay acyclic. `A -> B -> C -> A` is rejected
 * before it is written, because a cycle makes progress rollups, schedule forecasts and the
 * Gantt meaningless, and it is far cheaper to refuse the edge than to repair the data.
 */

export interface Edge {
  predecessorId: string;
  successorId: string;
}

/** Adjacency from predecessor to its successors. */
export function buildAdjacency(edges: readonly Edge[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const list = graph.get(edge.predecessorId);
    if (list) list.push(edge.successorId);
    else graph.set(edge.predecessorId, [edge.successorId]);
  }
  return graph;
}

/**
 * Whether `to` can already be reached from `from` by following successors.
 *
 * Adding `to -> from` is safe exactly when this is false. Iterative rather than recursive
 * so that a long chain cannot overflow the stack.
 */
export function reaches(graph: Map<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const next of graph.get(current) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * The cycle that adding `predecessorId -> successorId` would create, as a readable path
 * such as `A -> B -> C -> A`, or null when the edge is safe.
 *
 * The path is returned rather than a bare boolean so the error message can tell the user
 * which tasks are involved instead of merely refusing.
 */
export function findCycle(existing: readonly Edge[], candidate: Edge): string[] | null {
  const graph = buildAdjacency(existing);
  // The new edge closes a cycle precisely when the successor already reaches the
  // predecessor.
  const path = shortestPath(graph, candidate.successorId, candidate.predecessorId);
  if (path == null) return null;
  return [...path, candidate.successorId];
}

/** Breadth-first shortest path, so the reported cycle is the smallest one. */
export function shortestPath(
  graph: Map<string, string[]>,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const previous = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of graph.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === to) {
        const path = [next];
        let step = current;
        while (step !== from) {
          path.unshift(step);
          step = previous.get(step) as string;
        }
        path.unshift(from);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Topological order of the given task ids, or null when the graph already contains a
 * cycle. Used by the importer, which validates a whole sheet of dependencies at once.
 */
export function topologicalOrder(ids: readonly string[], edges: readonly Edge[]): string[] | null {
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const graph = new Map<string, string[]>();

  for (const edge of edges) {
    if (!indegree.has(edge.predecessorId) || !indegree.has(edge.successorId)) continue;
    indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
    const list = graph.get(edge.predecessorId);
    if (list) list.push(edge.successorId);
    else graph.set(edge.predecessorId, [edge.successorId]);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of graph.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return order.length === ids.length ? order : null;
}

/**
 * Earliest start implied by Finish-to-Start predecessors: the day after the latest
 * predecessor finishes, plus any lag. Returns null when no predecessor has an end date.
 *
 * This is advisory. Ekavist does not silently reschedule a task the user has dated; it
 * surfaces the conflict (spec section 20 asks for a warning, not automatic movement).
 */
export function earliestStartFromPredecessors(
  predecessors: readonly { dueDate: string | null; lagDays: number }[],
  addDays: (date: string, days: number) => string,
): string | null {
  let latest: string | null = null;
  for (const predecessor of predecessors) {
    if (predecessor.dueDate == null) continue;
    const candidate = addDays(predecessor.dueDate, 1 + predecessor.lagDays);
    if (latest == null || candidate > latest) latest = candidate;
  }
  return latest;
}
