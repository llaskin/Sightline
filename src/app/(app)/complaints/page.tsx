import Link from 'next/link';
import { pageMembership } from '@/server/page-data';
import { listClients } from '@/server/repositories/clients';
import { listComplaints, toComplaintView } from '@/server/repositories/complaints';
import {
  COMPLAINT_CATEGORY_LABELS,
  complaintCategorySchema,
  complaintStatusSchema,
  type ComplaintCategory,
  type ComplaintStatus,
} from '@/domain/complaint-schema';
import { Badge, Card, CardHeader, EmptyState, NotProvided } from '@/components/ui/primitives';
import { Button, ButtonLink } from '@/components/ui/button';
import { SelectField } from '@/components/ui/fields';
import {
  ComplaintForm,
  ComplaintStatusActions,
  COMPLAINT_SCOPE_LABELS,
  COMPLAINT_STATUS_LABELS,
  type ComplaintScope,
} from '@/features/complaints/complaint-form';
import { formatDateRange, formatInstant } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Complaints - Sightline' };

const PAGE_SIZE = 25;

const STATUS_TONE: Record<ComplaintStatus, 'neutral' | 'accent' | 'positive'> = {
  open: 'neutral',
  analyzed: 'accent',
  resolved: 'positive',
};

/** A filter value is used only when it is one the repository can mean something by. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{
    clientId?: string;
    status?: string;
    category?: string;
    cursor?: string;
  }>;
}) {
  const membership = await pageMembership();
  const { clientId, status, category, cursor } = await searchParams;

  // Archived clients are included so an older complaint still shows a name.
  const clientPage = await listClients(membership, { limit: 100, cursor: null, includeArchived: true });
  const clientNames = new Map(clientPage.items.map((client) => [client.id, client.name]));
  const activeClients = clientPage.items.filter((client) => client.archivedAt === null);

  const selectedClientId = clientNames.has(clientId ?? '') ? (clientId as string) : null;
  const selectedStatus = oneOf<ComplaintStatus>(status, complaintStatusSchema.options);
  const selectedCategory = oneOf<ComplaintCategory>(category, complaintCategorySchema.options);

  const page = await listComplaints(membership, {
    limit: PAGE_SIZE,
    cursor: cursor ?? null,
    clientId: selectedClientId,
    status: selectedStatus,
    category: selectedCategory,
  });
  const complaints = page.items.map(toComplaintView);

  const filterQuery = new URLSearchParams();
  if (selectedClientId) filterQuery.set('clientId', selectedClientId);
  if (selectedStatus) filterQuery.set('status', selectedStatus);
  if (selectedCategory) filterQuery.set('category', selectedCategory);

  function nextPageHref(nextCursor: string): string {
    const query = new URLSearchParams(filterQuery);
    query.set('cursor', nextCursor);
    return `/complaints?${query.toString()}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight text-ink">Complaints</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          What each client actually said, kept in their own words
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-0">
            <CardHeader title="Filters" />
            <form method="get" action="/complaints" className="flex flex-col gap-4 px-4 pb-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SelectField
                  label="Client"
                  name="clientId"
                  defaultValue={selectedClientId ?? ''}
                  options={[
                    { value: '', label: 'All clients' },
                    ...clientPage.items.map((client) => ({
                      value: client.id,
                      label: client.archivedAt ? `${client.name} (archived)` : client.name,
                    })),
                  ]}
                />
                <SelectField
                  label="Status"
                  name="status"
                  defaultValue={selectedStatus ?? ''}
                  options={[
                    { value: '', label: 'Any status' },
                    ...complaintStatusSchema.options.map((value) => ({
                      value,
                      label: COMPLAINT_STATUS_LABELS[value],
                    })),
                  ]}
                />
                <SelectField
                  label="Category"
                  name="category"
                  defaultValue={selectedCategory ?? ''}
                  options={[
                    { value: '', label: 'Any category' },
                    ...complaintCategorySchema.options.map((value) => ({
                      value,
                      label: COMPLAINT_CATEGORY_LABELS[value],
                    })),
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary">
                  Apply filters
                </Button>
                <ButtonLink href="/complaints" variant="ghost">
                  Clear
                </ButtonLink>
              </div>
            </form>
          </Card>

          {complaints.length === 0 ? (
            <Card>
              <EmptyState
                title="No complaints match this view"
                description={
                  filterQuery.toString().length > 0
                    ? 'Nothing is stored under these filters. Clear them to see every recorded complaint.'
                    : 'Record what a client said, in their own words, and it will be listed here. A complaint can be saved before any report exists.'
                }
                action={
                  filterQuery.toString().length > 0 ? (
                    <ButtonLink href="/complaints">Clear filters</ButtonLink>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <ul className="flex flex-col gap-4">
              {complaints.map((complaint) => {
                const clientName = clientNames.get(complaint.clientId);
                return (
                  <li key={complaint.id}>
                    <Card as="article" className="p-0">
                      <CardHeader
                        title={clientName ?? <NotProvided />}
                        action={
                          <Badge tone={STATUS_TONE[complaint.status]}>
                            {COMPLAINT_STATUS_LABELS[complaint.status]}
                          </Badge>
                        }
                      />
                      <div className="px-4 pb-4">
                        <blockquote className="rounded-[10px] border border-complaint-line bg-complaint px-4 py-3">
                          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
                            {complaint.originalText}
                          </p>
                        </blockquote>

                        <dl className="mt-3 flex flex-wrap items-center gap-2">
                          <div>
                            <dt className="sr-only">Category</dt>
                            <dd>
                              {/* The column is stored as text, so the label
                                  lookup is narrowed here. */}
                              <Badge>
                                {COMPLAINT_CATEGORY_LABELS[complaint.category as ComplaintCategory]}
                              </Badge>
                            </dd>
                          </div>
                          <div>
                            <dt className="sr-only">Scope</dt>
                            <dd>
                              <Badge>{COMPLAINT_SCOPE_LABELS[complaint.scope as ComplaintScope]}</Badge>
                            </dd>
                          </div>
                          <div>
                            <dt className="sr-only">Complaint period</dt>
                            <dd>
                              <Badge>
                                Complaint period:{' '}
                                {formatDateRange(complaint.periodStart, complaint.periodEnd)}
                              </Badge>
                            </dd>
                          </div>
                          <div>
                            <dt className="sr-only">Received</dt>
                            <dd>
                              {/* Stored as an instant and shown in UTC, which is
                                  named so it cannot be read as local time. */}
                              <Badge>Received {formatInstant(complaint.receivedAt)} UTC</Badge>
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                          <ComplaintStatusActions
                            complaint={{
                              id: complaint.id,
                              status: complaint.status,
                              revision: complaint.revision,
                            }}
                          />
                          <ButtonLink
                            href={`/analyses/new?clientId=${complaint.clientId}&complaintId=${complaint.id}`}
                            variant="primary"
                          >
                            Start an analysis
                          </ButtonLink>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          {page.nextCursor ? (
            <div>
              <Link
                href={nextPageHref(page.nextCursor)}
                className="inline-flex min-h-[44px] items-center rounded-[10px] border border-line-strong bg-surface-raised px-4 text-[13px] text-ink hover:border-ink-faint"
              >
                Next page
              </Link>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {activeClients.length === 0 ? (
            <Card>
              <EmptyState
                title="Add a client first"
                description="A complaint belongs to a client, so there is nothing to attach this one to yet."
                action={<ButtonLink href="/clients?new=1">Add a client</ButtonLink>}
              />
            </Card>
          ) : (
            <ComplaintForm
              // Remounted when the client filter changes, so the form defaults
              // to the client currently being looked at.
              key={selectedClientId ?? 'all'}
              clients={activeClients.map((client) => ({ id: client.id, name: client.name }))}
              defaultClientId={selectedClientId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
