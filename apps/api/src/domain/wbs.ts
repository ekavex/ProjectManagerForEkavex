/**
 * WBS numbering.
 *
 * Codes are the dotted paths the spec shows (`1.0`, `1.1`, `2.3.1`). They are stored on
 * the row rather than computed on read, because every Gantt, export and report sorts by
 * them; this module recomputes the whole tree whenever its shape changes.
 *
 * Root items are numbered `1.0`, `2.0`, … to match the spec's example; deeper levels drop
 * the trailing zero (`1.1`, `1.1.2`).
 */

export interface WbsShapeNode {
  id: string;
  parentId: string | null;
  position: number;
}

export interface WbsNumbering {
  id: string;
  code: string;
  depth: number;
  position: number;
}

/**
 * Assigns a code and depth to every node, honouring `position` among siblings.
 *
 * Nodes whose parent is missing from the input are treated as roots, so a partially
 * loaded tree still produces usable output rather than throwing.
 */
export function numberWbsTree(nodes: readonly WbsShapeNode[]): WbsNumbering[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string | null, WbsShapeNode[]>();

  for (const node of nodes) {
    const parentKey = node.parentId != null && byId.has(node.parentId) ? node.parentId : null;
    const siblings = childrenOf.get(parentKey);
    if (siblings) siblings.push(node);
    else childrenOf.set(parentKey, [node]);
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  const result: WbsNumbering[] = [];
  const visited = new Set<string>();

  function walk(parentKey: string | null, prefix: string, depth: number): void {
    const siblings = childrenOf.get(parentKey) ?? [];
    siblings.forEach((node, index) => {
      // Defends against a corrupt parent chain rather than looping forever.
      if (visited.has(node.id)) return;
      visited.add(node.id);

      const ordinal = index + 1;
      const code = depth === 0 ? `${ordinal}.0` : `${prefix}.${ordinal}`;
      result.push({ id: node.id, code, depth, position: index });
      walk(node.id, depth === 0 ? `${ordinal}` : code, depth + 1);
    });
  }

  walk(null, '', 0);
  return result;
}

/**
 * Sort key that orders `1.0`, `1.2`, `1.10`, `2.0` correctly — a plain string sort would
 * put `1.10` before `1.2`.
 */
export function wbsSortKey(code: string): string {
  return code
    .split('.')
    .map((segment) => segment.padStart(6, '0'))
    .join('.');
}

export function compareWbsCodes(a: string, b: string): number {
  return wbsSortKey(a).localeCompare(wbsSortKey(b));
}

/**
 * Whether moving `nodeId` under `newParentId` would place the node inside its own
 * subtree, which would detach that subtree from the project.
 */
export function wouldCreateWbsCycle(
  nodes: readonly WbsShapeNode[],
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === nodeId) return true;

  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const seen = new Set<string>();
  let current: string | null | undefined = newParentId;

  while (current != null) {
    if (current === nodeId) return true;
    if (seen.has(current)) return true; // already-corrupt chain; refuse the move
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/** Ids of `rootId` and everything beneath it. */
export function subtreeIds(nodes: readonly WbsShapeNode[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    const list = childrenOf.get(node.parentId);
    if (list) list.push(node.id);
    else childrenOf.set(node.parentId, [node.id]);
  }

  const collected: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    collected.push(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return collected;
}
