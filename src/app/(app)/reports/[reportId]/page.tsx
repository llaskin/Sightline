import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, FilePlus2 } from 'lucide-react';
import { pageMembership } from '@/server/page-data';
import { findReport } from '@/server/repositories/reports';
import { findClient } from '@/server/repositories/clients';
import {
  normalizedReportSchema,
  type DatasetSource,
  type NormalizedReport,
} from '@/domain/report-schema';
import { Card, CardHeader, Badge, EmptyState, NotProvided } from '@/components/ui/primitives';
import { formatCount, formatDate, formatDateRange, formatInstant } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DATASET_TITLES: Record<string, string> = {
  organic: 'Organic summary',
  keywords: 'Keywords',
  forms: 'Forms',
  landingPages: 'Landing pages',
  trafficTrend: 'Traffic trend',
  outcomes: 'Business outcomes',
};

/** A count that was never supplied must read as unknown, never as zero. */
function Count({ value }: { value: number | null }) {
  if (value === null) return <NotProvided />;
  return <>{formatCount(value)}</>;
}

function Text({ value }: { value: string | null }) {
  if (value === null || value.trim() === '') return <NotProvided />;
  return <>{value}</>;
}

/** A plain anchor, because an export is a file download and not a page. */
function ExportLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-surface-raised px-4 text-[13px] font-medium text-ink hover:border-ink-faint"
    >
      <Download size={15} aria-hidden />
      {children}
    </a>
  );
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const membership = await pageMembership();
  const row = await findReport(membership, reportId);
  if (!row) notFound();

  const report: NormalizedReport = normalizedReportSchema.parse(row.snapshot);
  const client = await findClient(membership, row.clientId);
  const { metadata, datasets, sources } = report;

  const sourceEntries = Object.entries(sources).filter(
    (entry): entry is [string, { baseline: DatasetSource; current: DatasetSource }] =>
      entry[1] !== null,
  );

  return (
    <div className="mx-auto max-w-6xl py-6">
      <Link href={`/clients/${row.clientId}`} className="text-[12px] text-ink-muted hover:text-ink">
        Back to {client?.name ?? 'the client'}
      </Link>

      <div className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-[28px] font-semibold text-ink">
            {row.reportLabel}
            <Badge tone="accent">Committed</Badge>
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {client?.name ?? 'Unknown client'} &middot; committed{' '}
            {formatDate(row.createdAt.toISOString().slice(0, 10))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportLink href={`/api/reports/${row.id}/export?dataset=keywords`}>
            Keywords CSV
          </ExportLink>
          <ExportLink href={`/api/reports/${row.id}/export?dataset=pages`}>Pages CSV</ExportLink>
          <Link
            href={`/reports/new?clientId=${row.clientId}&supersedes=${row.id}`}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            <FilePlus2 size={15} aria-hidden />
            Create corrected report
          </Link>
        </div>
      </div>

      <Card className="mb-4">
        <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
          A committed report is immutable. Nothing on this page can be edited, and no part of it is
          recomputed on read. A mistake is corrected by importing a new report that supersedes this
          one, which leaves both on record and makes the correction visible.
          {row.supersedesReportId ? (
            <>
              {' '}
              This report supersedes{' '}
              <Link
                href={`/reports/${row.supersedesReportId}`}
                className="text-[#a99bff] hover:underline"
              >
                an earlier report
              </Link>
              , which remains readable exactly as it was committed.
            </>
          ) : null}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Report summary" />
          <dl className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 pb-4 text-[12px]">
            <dt className="text-ink-faint">Current period</dt>
            <dd className="text-ink">
              {formatDateRange(metadata.currentStart, metadata.currentEnd)}
            </dd>
            <dt className="text-ink-faint">Baseline period</dt>
            <dd className="text-ink">
              {formatDateRange(metadata.baselineStart, metadata.baselineEnd)}
            </dd>
            <dt className="text-ink-faint">Time zone</dt>
            <dd className="text-ink">{metadata.timeZone}</dd>
            <dt className="text-ink-faint">Channel</dt>
            <dd className="text-ink">Organic search</dd>
            <dt className="text-ink-faint">Property</dt>
            <dd className="text-ink"><Text value={metadata.propertyLabel} /></dd>
            <dt className="text-ink-faint">Lead definition</dt>
            <dd className="text-ink"><Text value={metadata.leadDefinition} /></dd>
            <dt className="text-ink-faint">Lead event name</dt>
            <dd className="text-ink"><Text value={metadata.leadEventName} /></dd>
            <dt className="text-ink-faint">Tracking status</dt>
            <dd className="text-ink">{metadata.trackingStatus}</dd>
            <dt className="text-ink-faint">Tracking evidence</dt>
            <dd className="text-ink"><Text value={metadata.trackingEvidenceNote} /></dd>
            <dt className="text-ink-faint">Tracking reviewed</dt>
            <dd className="text-ink">
              {metadata.trackingReviewedAt ? (
                formatInstant(metadata.trackingReviewedAt)
              ) : (
                <NotProvided />
              )}
            </dd>
            <dt className="text-ink-faint">Reviewed by</dt>
            <dd className="text-ink"><Text value={metadata.trackingReviewedBy} /></dd>
            <dt className="text-ink-faint">Schema version</dt>
            <dd className="text-ink">{row.schemaVersion}</dd>
            <dt className="text-ink-faint">Content hash</dt>
            <dd className="break-all text-ink">{row.contentHash}</dd>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Selections" />
          <dl className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 pb-4 text-[12px]">
            <dt className="text-ink-faint">Form used for rates</dt>
            <dd className="text-ink">
              {report.selectedForm ? (
                `${report.selectedForm.formId} (${report.selectedForm.scope})`
              ) : (
                <NotProvided>No form selected</NotProvided>
              )}
            </dd>
            <dt className="text-ink-faint">Form definitions confirmed</dt>
            <dd className="text-ink">
              {report.formDefinitionAcknowledged ? 'Yes' : 'Not confirmed'}
            </dd>
            <dt className="text-ink-faint">Trend granularity</dt>
            <dd className="text-ink">
              {report.trendGranularity ?? <NotProvided>Not stated</NotProvided>}
            </dd>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Provenance" />
        {sourceEntries.length === 0 ? (
          <EmptyState
            title="No source metadata"
            description="This report carries no dataset provenance, which should not happen for a committed report."
          />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[1000px] border-collapse text-left text-[12px]">
              <caption className="sr-only">
                Every stated source fact, per dataset and per period
              </caption>
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Dataset</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Source kind</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Source label</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Exported at</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Coverage</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Scope key</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Definition version</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Source time zone</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Zone difference</th>
                  <th scope="col" className="py-2 font-medium">Evidence note</th>
                </tr>
              </thead>
              <tbody>
                {sourceEntries.flatMap(([dataset, periods]) =>
                  (['baseline', 'current'] as const).map((period) => (
                    <tr
                      key={`${dataset}-${period}`}
                      className="border-b border-line/60 align-top last:border-0"
                    >
                      <td className="py-2 pr-3 text-ink">{DATASET_TITLES[dataset] ?? dataset}</td>
                      <td className="py-2 pr-3 capitalize text-ink-muted">{period}</td>
                      <td className="py-2 pr-3 text-ink-muted">{periods[period].sourceKind}</td>
                      <td className="py-2 pr-3 text-ink-muted">
                        <Text value={periods[period].sourceLabel} />
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        {formatInstant(periods[period].exportedAt)}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">{periods[period].coverage}</td>
                      <td className="py-2 pr-3 text-ink-muted">
                        <Text value={periods[period].scopeKey} />
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        <Text value={periods[period].definitionVersion} />
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        <Text value={periods[period].timeZone} />
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">
                        {periods[period].acknowledgedTimeZoneDifference
                          ? 'Acknowledged'
                          : 'Not flagged'}
                      </td>
                      <td className="py-2 text-ink-muted">
                        <Text value={periods[period].evidenceNote} />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Organic summary" />
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
            <caption className="sr-only">Organic sessions, active users and lead sessions</caption>
            <thead>
              <tr className="border-b border-line text-ink-faint">
                <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Sessions</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Active users</th>
                <th scope="col" className="py-2 text-right font-medium">Lead sessions</th>
              </tr>
            </thead>
            <tbody>
              {datasets.organic.map((organicRow) => (
                <tr key={organicRow.period} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3 capitalize text-ink">{organicRow.period}</td>
                  <td className="py-2 pr-3 text-right text-ink-muted">
                    {formatCount(organicRow.sessions)}
                  </td>
                  <td className="py-2 pr-3 text-right text-ink-muted">
                    <Count value={organicRow.activeUsers} />
                  </td>
                  <td className="py-2 text-right text-ink-muted">
                    <Count value={organicRow.leadSessions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Keywords" />
        {datasets.keywords === null || datasets.keywords.length === 0 ? (
          <EmptyState
            title="No keyword rows"
            description="This report was committed without a keywords dataset, so ranking movement is unknown rather than flat."
          />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Every imported keyword observation</caption>
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Keyword</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Device</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Location</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Search engine</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Position</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Intent</th>
                  <th scope="col" className="py-2 font-medium">Tracked</th>
                </tr>
              </thead>
              <tbody>
                {datasets.keywords.map((keyword, index) => (
                  <tr
                    key={`${keyword.period}-${keyword.keyword}-${index}`}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="py-2 pr-3 capitalize text-ink-muted">{keyword.period}</td>
                    <td className="py-2 pr-3 text-ink">{keyword.keyword}</td>
                    <td className="py-2 pr-3 text-ink-muted">{keyword.device}</td>
                    <td className="py-2 pr-3 text-ink-muted">{keyword.location}</td>
                    <td className="py-2 pr-3 text-ink-muted">{keyword.searchEngine}</td>
                    <td className="py-2 pr-3 text-right text-ink-muted">
                      {keyword.position ?? <NotProvided>Unranked</NotProvided>}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{keyword.intent}</td>
                    <td className="py-2 text-ink-muted">{keyword.tracked ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Forms" />
        {datasets.forms === null || datasets.forms.length === 0 ? (
          <EmptyState
            title="No form rows"
            description="A traffic export cannot show whether a submission reached the backend, so without form data a post-click failure stays unestablished."
          />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[620px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Imported form attempts, failures and error events</caption>
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Form</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Scope</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Attempts</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Failed attempts</th>
                  <th scope="col" className="py-2 text-right font-medium">Error events</th>
                </tr>
              </thead>
              <tbody>
                {datasets.forms.map((form, index) => (
                  <tr
                    key={`${form.period}-${form.formId}-${index}`}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="py-2 pr-3 capitalize text-ink-muted">{form.period}</td>
                    <td className="py-2 pr-3 text-ink">{form.formId}</td>
                    <td className="py-2 pr-3 text-ink-muted">{form.scope}</td>
                    <td className="py-2 pr-3 text-right text-ink-muted">
                      <Count value={form.attempts} />
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-muted">
                      <Count value={form.failedAttempts} />
                    </td>
                    <td className="py-2 text-right text-ink-muted">
                      {formatCount(form.errorEvents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Landing pages" />
        {datasets.landingPages === null || datasets.landingPages.length === 0 ? (
          <EmptyState
            title="No landing page rows"
            description="This report was committed without landing-page sessions, so traffic cannot be broken down by page."
          />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Imported landing-page sessions</caption>
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Path</th>
                  <th scope="col" className="py-2 text-right font-medium">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.landingPages.map((page, index) => (
                  <tr
                    key={`${page.period}-${page.path}-${index}`}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="py-2 pr-3 capitalize text-ink-muted">{page.period}</td>
                    <td className="py-2 pr-3 text-ink">{page.path}</td>
                    <td className="py-2 text-right text-ink-muted">{formatCount(page.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Traffic trend" />
        {datasets.trafficTrend === null || datasets.trafficTrend.length === 0 ? (
          <EmptyState
            title="Trend data not provided"
            description="No trend buckets were supplied. No line is drawn between two summary values, because that would invent points that were never measured."
          />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Supplied trend buckets</caption>
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Bucket</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Sessions</th>
                  <th scope="col" className="py-2 text-right font-medium">Active users</th>
                </tr>
              </thead>
              <tbody>
                {datasets.trafficTrend.map((bucket) => (
                  <tr
                    key={`${bucket.startDate}-${bucket.endDate}`}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="py-2 pr-3 text-ink">
                      {formatDateRange(bucket.startDate, bucket.endDate)}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-muted">
                      {formatCount(bucket.sessions)}
                    </td>
                    <td className="py-2 text-right text-ink-muted">
                      <Count value={bucket.activeUsers} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Business outcomes" />
        {datasets.outcomes === null || datasets.outcomes.length === 0 ? (
          <EmptyState
            title="No business outcomes"
            description="Received leads, qualified leads and revenue were not supplied, so they stay unknown. A complaint about leads cannot be settled from traffic alone."
          />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[860px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Imported business outcomes with their attribution</caption>
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Metric</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Scope</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Baseline</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Current</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Currency</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Source</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Coverage</th>
                  <th scope="col" className="py-2 font-medium">Attribution note</th>
                </tr>
              </thead>
              <tbody>
                {datasets.outcomes.map((outcome, index) => (
                  <tr
                    key={`${outcome.metric}-${outcome.scope}-${index}`}
                    className="border-b border-line/60 align-top last:border-0"
                  >
                    <td className="py-2 pr-3 text-ink">{outcome.metric}</td>
                    <td className="py-2 pr-3 text-ink-muted">{outcome.scope}</td>
                    <td className="py-2 pr-3 text-right text-ink-muted">
                      <Count value={outcome.baselineValue} />
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-muted">
                      <Count value={outcome.currentValue} />
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      <Text value={outcome.currency} />
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {outcome.sourceLabel} ({outcome.sourceKind}), {outcome.definitionVersion}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{outcome.coverage}</td>
                    <td className="py-2 text-ink-muted">
                      <Text value={outcome.attributionNote} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
