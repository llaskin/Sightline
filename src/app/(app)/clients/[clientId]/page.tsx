import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageMembership } from '@/server/page-data';
import {
  clientDefinitionsSchema,
  findClient,
  type ClientRecord,
} from '@/server/repositories/clients';
import { listReports, toReportSummary } from '@/server/repositories/reports';
import { listComplaints } from '@/server/repositories/complaints';
import { Card, CardHeader, Badge, EmptyState, NotProvided } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import {
  ClientArchiveButton,
  EditClientPanel,
  type ClientView,
} from '@/features/clients/client-form';
import { formatDate, formatDateRange } from '@/lib/format';

export const dynamic = 'force-dynamic';

function toView(row: ClientRecord): ClientView {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    timeZone: row.timeZone,
    definitions: clientDefinitionsSchema.parse(row.definitions ?? {}),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    revision: row.revision,
  };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const membership = await pageMembership();
  const row = await findClient(membership, clientId);
  if (!row) notFound();

  const client = toView(row);
  const [reportPage, complaintPage] = await Promise.all([
    listReports(membership, { limit: 50, cursor: null, clientId }),
    listComplaints(membership, { limit: 50, cursor: null, clientId }),
  ]);
  const reports = reportPage.items.map(toReportSummary);
  const complaints = complaintPage.items;

  return (
    <div className="mx-auto max-w-5xl py-6">
      <Link href="/clients" className="text-[12px] text-ink-muted hover:text-ink">
        Back to clients
      </Link>

      <div className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-[28px] font-semibold text-ink">
            {client.name}
            {client.archivedAt ? <Badge tone="caution">Archived</Badge> : null}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {client.domain} &middot; {client.timeZone}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {client.archivedAt === null ? (
            <ButtonLink href={`/reports/new?clientId=${client.id}`} variant="primary">
              Import a report
            </ButtonLink>
          ) : null}
          <ClientArchiveButton client={client} role={membership.role} />
        </div>
      </div>

      {client.archivedAt ? (
        <Card className="mb-4 border-caution/40">
          <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
            This client was archived on {formatDate(client.archivedAt.slice(0, 10))}. Existing
            reports, complaints and analyses stay readable, but new imports, complaints and analyses
            are refused until it is restored.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <EditClientPanel client={client} />

          <Card>
            <CardHeader title="Removing a client" />
            <p className="px-4 pb-4 text-[13px] leading-relaxed text-ink-muted">
              Permanent deletion is not available in this release. Archiving is the only removal
              this application performs, and it is reversible. Nothing here deletes a client, its
              reports or its analyses, so please do not read archiving as a delete.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={`Reports (${reports.length})`} />
            {reports.length === 0 ? (
              <EmptyState
                title="No reports yet"
                description="Import two comparable periods to produce the first committed report for this client."
              />
            ) : (
              <ul className="divide-y divide-line">
                {reports.map((report) => (
                  <li key={report.id} className="px-4 py-3">
                    <Link
                      href={`/reports/${report.id}`}
                      className="text-[13px] font-medium text-ink hover:text-[#a99bff]"
                    >
                      {report.reportLabel}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      Current {formatDateRange(report.currentStart, report.currentEnd)}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      Baseline {formatDateRange(report.baselineStart, report.baselineEnd)}
                      {report.supersedesReportId ? ' - correction' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={`Complaints (${complaints.length})`} />
            {complaints.length === 0 ? (
              <EmptyState
                title="No complaints recorded"
                description="A complaint is recorded in the client's own words before any analysis reads it."
              />
            ) : (
              <ul className="divide-y divide-line">
                {complaints.map((complaint) => (
                  <li key={complaint.id} className="px-4 py-3">
                    <p className="text-[13px] leading-relaxed text-ink">
                      {complaint.originalText.length > 180
                        ? `${complaint.originalText.slice(0, 180)}...`
                        : complaint.originalText}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {complaint.category} &middot; {complaint.scope} &middot; {complaint.status}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      Period {formatDateRange(complaint.periodStart, complaint.periodEnd)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Current definitions" />
            <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 pb-4 text-[12px]">
              <dt className="text-ink-faint">Property label</dt>
              <dd className="text-ink">
                {client.definitions.propertyLabel || <NotProvided />}
              </dd>
              <dt className="text-ink-faint">Lead definition</dt>
              <dd className="text-ink">
                {client.definitions.leadDefinition || <NotProvided />}
              </dd>
              <dt className="text-ink-faint">Lead event name</dt>
              <dd className="text-ink">{client.definitions.leadEventName ?? <NotProvided />}</dd>
              <dt className="text-ink-faint">Default window</dt>
              <dd className="text-ink">{client.definitions.defaultWindowDays} days</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
