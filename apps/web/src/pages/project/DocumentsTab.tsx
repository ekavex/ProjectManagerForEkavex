/**
 * Documents and shared resources (spec sections 35 to 37).
 *
 * Version 1 stores links and their metadata, not files (decision D-007). Nothing here
 * claims to be connected to Google Drive: a Drive link is recognised by its host and
 * labelled, which is all it is.
 */
import type { CreateDocumentInput, DocumentCategory, ProjectDetail } from '@ekavist/shared';
import { DOCUMENT_CATEGORIES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import { FilterBar, Pagination } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise } from '../../lib/format.js';
import { useDocuments, usePhases, useResources } from '../../lib/queries.js';

export function DocumentsTab({ project }: { project: ProjectDetail }) {
  const [view, setView] = useState<'documents' | 'resources'>('documents');

  return (
    <>
      <div className="mb-3 flex gap-1.5">
        <Button
          size="sm"
          variant={view === 'documents' ? 'primary' : 'secondary'}
          onClick={() => setView('documents')}
        >
          Documents
        </Button>
        <Button
          size="sm"
          variant={view === 'resources' ? 'primary' : 'secondary'}
          onClick={() => setView('resources')}
        >
          Everything shared
        </Button>
      </div>

      {view === 'documents' ? (
        <DocumentList project={project} />
      ) : (
        <ResourceLibrary project={project} />
      )}
    </>
  );
}

function DocumentList({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<DocumentCategory | ''>('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError, error, refetch } = useDocuments(project.id, {
    page,
    pageSize: 25,
    category: category === '' ? undefined : category,
    search: search.trim() === '' ? undefined : search.trim(),
  });

  const canAdd = project.capabilities.includes('document:create');
  const canDelete = project.capabilities.includes('document:delete');

  const remove = useMutation({
    mutationFn: (documentId: string) =>
      api.delete(`/projects/${project.id}/documents/${documentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'documents'] });
      toast.success('Document removed.');
    },
  });

  return (
    <>
      <FilterBar>
        <Input
          type="search"
          placeholder="Search documents"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-56"
        />
        <Select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as DocumentCategory | '');
            setPage(1);
          }}
          className="w-48"
          aria-label="Filter by category"
        >
          <option value="">Any category</option>
          {DOCUMENT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        {canAdd && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            Add document
          </Button>
        )}
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Requirements, designs, test reports and final deliverables belong here."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Document</Th>
                  <Th>Category</Th>
                  <Th>Phase</Th>
                  <Th>Version</Th>
                  <Th>Added</Th>
                  {canDelete && <Th />}
                </tr>
              </thead>
              <tbody>
                {data.data.map((document) => (
                  <tr key={document.id} className="hover:bg-canvas">
                    <Td>
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-accent hover:underline"
                      >
                        {document.name}
                      </a>
                      {document.description != null && (
                        <span className="block truncate text-[12px] text-ink-faint">
                          {document.description}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone="neutral">{humanise(document.category)}</Badge>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {document.phase?.name ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">{document.version ?? '—'}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink-faint">
                        {document.addedBy?.fullName ?? '—'}
                        <span className="block">{formatDate(document.createdAt.slice(0, 10))}</span>
                      </span>
                    </Td>
                    {canDelete && (
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void confirm({
                              title: `Remove ${document.name}?`,
                              message:
                                'The link is removed from Ekavist. The file itself is untouched.',
                              confirmLabel: 'Remove',
                            }).then((ok) => {
                              if (ok) remove.mutate(document.id);
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <DocumentModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function ResourceLibrary({ project }: { project: ProjectDetail }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useResources(project.id, {
    page,
    pageSize: 30,
    search: search.trim() === '' ? undefined : search.trim(),
  });

  return (
    <>
      <FilterBar>
        <Input
          type="search"
          placeholder="Search everything shared"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-64"
        />
      </FilterBar>

      <Card
        bodyClassName="p-0"
        title="Shared resources"
        description="Links and files from documents, tasks and the chat, in one list."
      >
        {isLoading ? (
          <LoadingState />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState title="Nothing shared yet" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Resource</Th>
                  <Th>Kind</Th>
                  <Th>From</Th>
                  <Th>Shared by</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((resource) => (
                  <tr key={`${resource.source}-${resource.id}`} className="hover:bg-canvas">
                    <Td>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-accent hover:underline"
                      >
                        {resource.name}
                      </a>
                    </Td>
                    <Td>
                      <Badge tone={resource.kind === 'GOOGLE_DRIVE' ? 'info' : 'neutral'}>
                        {resource.kind === 'GOOGLE_DRIVE' ? 'Drive' : humanise(resource.kind)}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink-faint">
                        {humanise(resource.source)}
                        {resource.task != null && ` · ${resource.task.reference}`}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink-faint">
                        {resource.addedBy?.fullName ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular text-[12px] text-ink-faint">
                        {formatDate(resource.createdAt.slice(0, 10))}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

function DocumentModal({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: phases } = usePhases(project.id);
  const [form, setForm] = useState<Partial<CreateDocumentInput>>({ category: 'OTHER' });

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/documents`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Document added.');
      setForm({ category: 'OTHER' });
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the document.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a document"
      description="Ekavist stores the link and its details. The file stays where it is."
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="document-form" loading={create.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id="document-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="document-name" required>
          <Input
            id="document-name"
            required
            autoFocus
            value={form.name ?? ''}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <Field label="Link" htmlFor="document-url" required>
          <Input
            id="document-url"
            type="url"
            required
            placeholder="https://…"
            value={form.url ?? ''}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="document-category">
            <Select
              id="document-category"
              value={form.category ?? 'OTHER'}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value as DocumentCategory })
              }
            >
              {DOCUMENT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Version" htmlFor="document-version">
            <Input
              id="document-version"
              placeholder="v1.0"
              value={form.version ?? ''}
              onChange={(event) => setForm({ ...form, version: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Phase" htmlFor="document-phase">
          <Select
            id="document-phase"
            value={form.phaseId ?? ''}
            onChange={(event) => setForm({ ...form, phaseId: event.target.value || undefined })}
          >
            <option value="">No phase</option>
            {(phases ?? []).map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.sequence}. {phase.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Description" htmlFor="document-description">
          <Textarea
            id="document-description"
            rows={2}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
