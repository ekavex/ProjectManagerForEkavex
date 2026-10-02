/**
 * Role permissions (spec sections 6.1 and 57): what each organisation role may do
 * everywhere. Rights inside a project come from the person's role in that project and are
 * not edited here; administrators always hold everything.
 */
import type { CurrentUser, OrgRole, Permission, RolePermissionRow } from '@ekavist/shared';
import { PERMISSIONS } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useToast } from '../../components/ui/overlays.js';
import { PageHeader } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { ApiError, api } from '../../lib/api.js';
import { humanise } from '../../lib/format.js';
import { keys, useRolePermissions } from '../../lib/queries.js';

/** Permissions grouped by the thing they act on, in the order of the vocabulary. */
function groupPermissions(): [string, Permission[]][] {
  const groups = new Map<string, Permission[]>();
  for (const permission of PERMISSIONS) {
    const area = permission.split(':')[0] as string;
    groups.set(area, [...(groups.get(area) ?? []), permission]);
  }
  return [...groups.entries()];
}

export function RolesPage() {
  const { can, refreshUser, user } = useAuth();
  const { data, isLoading, isError, error, refetch } = useRolePermissions();

  if (!can('role:manage')) {
    return (
      <div className="card">
        <EmptyState
          title="Administrators only"
          description="Role permissions are managed by administrators."
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Roles and permissions"
        subtitle="What each organisation role may do across Ekavist. Rights inside a project follow the person's role in that project."
      />
      {isLoading ? (
        <div className="card">
          <LoadingState />
        </div>
      ) : isError || data == null ? (
        <div className="card">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : (
        <Matrix
          rows={data}
          onSaved={() => {
            // The signed-in user's own grants may have changed.
            if (user != null) void api.get<CurrentUser>('/auth/me').then(refreshUser);
          }}
        />
      )}
    </>
  );
}

function Matrix({ rows, onSaved }: { rows: RolePermissionRow[]; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const groups = useMemo(groupPermissions, []);
  const [draft, setDraft] = useState<Record<string, Set<Permission>>>(() =>
    Object.fromEntries(rows.map((row) => [row.role, new Set(row.permissions)])),
  );

  const changed = (role: OrgRole): boolean => {
    const saved = rows.find((row) => row.role === role)?.permissions ?? [];
    const current = draft[role] ?? new Set();
    return saved.length !== current.size || saved.some((permission) => !current.has(permission));
  };

  const save = useMutation({
    mutationFn: (role: OrgRole) =>
      api.put(`/organization/roles/${role}`, { permissions: [...(draft[role] ?? [])] }),
    onSuccess: (_data, role) => {
      void queryClient.invalidateQueries({ queryKey: keys.roles });
      toast.success(`${humanise(role)} permissions saved. They apply from the next request.`);
      onSaved();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the permissions.'),
  });

  const toggle = (role: OrgRole, permission: Permission): void => {
    const next = new Set(draft[role]);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    setDraft({ ...draft, [role]: next });
  };

  return (
    <Card bodyClassName="p-0">
      <Table>
        <thead>
          <tr>
            <Th>Permission</Th>
            {rows.map((row) => (
              <Th key={row.role} align="center">
                {humanise(row.role)}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([area, permissions]) => (
            <GroupRows
              key={area}
              area={area}
              permissions={permissions}
              rows={rows}
              draft={draft}
              onToggle={toggle}
            />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <Td />
            {rows.map((row) => (
              <Td key={row.role} align="center">
                {row.editable ? (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!changed(row.role)}
                    loading={save.isPending && save.variables === row.role}
                    onClick={() => save.mutate(row.role)}
                  >
                    Save
                  </Button>
                ) : (
                  <Badge tone="neutral">Always all</Badge>
                )}
              </Td>
            ))}
          </tr>
        </tfoot>
      </Table>
    </Card>
  );
}

function GroupRows({
  area,
  permissions,
  rows,
  draft,
  onToggle,
}: {
  area: string;
  permissions: Permission[];
  rows: RolePermissionRow[];
  draft: Record<string, Set<Permission>>;
  onToggle: (role: OrgRole, permission: Permission) => void;
}) {
  return (
    <>
      <tr>
        <Td
          colSpan={rows.length + 1}
          className="bg-canvas text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
        >
          {humanise(area)}
        </Td>
      </tr>
      {permissions.map((permission) => (
        <tr key={permission}>
          <Td className="font-mono text-[12px]">{permission}</Td>
          {rows.map((row) => (
            <Td key={row.role} align="center">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                aria-label={`${humanise(row.role)}: ${permission}`}
                checked={draft[row.role]?.has(permission) ?? false}
                disabled={!row.editable}
                onChange={() => onToggle(row.role, permission)}
              />
            </Td>
          ))}
        </tr>
      ))}
    </>
  );
}
