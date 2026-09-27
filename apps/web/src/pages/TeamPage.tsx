/**
 * The team directory (spec section 23).
 *
 * Read-only for most people: who is here, what they do, which department. Managing
 * accounts lives under Administration, which only an administrator sees.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, FilterBar, PageHeader, Pagination } from '../components/ui/page.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { humanise } from '../lib/format.js';
import { useDepartments, useUsers } from '../lib/queries.js';

export function TeamPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const { data: departments } = useDepartments();
  const { data, isLoading, isError, error, refetch } = useUsers({
    page,
    pageSize: 30,
    status: 'ACTIVE',
    search: search.trim() === '' ? undefined : search.trim(),
    departmentId: departmentId === '' ? undefined : departmentId,
  });

  return (
    <>
      <PageHeader title="Team" subtitle="Everyone at Ekavist." />

      <FilterBar>
        <Input
          type="search"
          placeholder="Search by name, email or role"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-64"
        />
        <Select
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            setPage(1);
          }}
          className="w-48"
          aria-label="Filter by department"
        >
          <option value="">Any department</option>
          {(departments ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState title="Nobody matched" description="Try a different search term." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Department</Th>
                  <Th>Manager</Th>
                  <Th>Skills</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <tr key={user.id} className="hover:bg-canvas">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={user.fullName} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{user.fullName}</span>
                          <a
                            href={`mailto:${user.email}`}
                            className="block truncate text-[11px] text-ink-faint hover:text-accent"
                          >
                            {user.email}
                          </a>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[13px]">{user.designation ?? '—'}</span>
                      <Badge tone="neutral" className="ml-1.5">
                        {humanise(user.role)}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {user.department?.name ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {user.manager?.fullName ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      {user.skills.length === 0 ? (
                        <span className="text-[12px] text-ink-faint">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {user.skills.slice(0, 4).map((skill) => (
                            <Badge key={skill} tone="neutral">
                              {skill}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      {departments != null && departments.length > 0 && (
        <Card title="Departments" className="mt-4">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((department) => (
              <li key={department.id} className="card px-3 py-2.5">
                <p className="text-[13px] font-medium text-ink">{department.name}</p>
                <p className="text-[12px] text-ink-faint">
                  {department.memberCount} {department.memberCount === 1 ? 'person' : 'people'}
                  {department.head != null && ` · led by ${department.head.fullName}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-4 text-[12px] text-ink-faint">
        Need to add someone or change an account?{' '}
        <Link to="/admin/users" className="text-accent hover:underline">
          People administration
        </Link>{' '}
        — administrators only.
      </p>
    </>
  );
}
