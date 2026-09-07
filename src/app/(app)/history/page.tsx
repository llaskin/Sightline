import { pageMembership } from '@/server/page-data';
import { listClients } from '@/server/repositories/clients';
import { listAnalyses, toAnalysisSummary } from '@/server/repositories/analyses';
import { diagnosisSchema, type Diagnosis } from '@/domain/analysis-schema';
import { HistoryTable, type AnalysisRow } from '@/features/history/history-table';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Analysis history - Sightline' };

const PAGE_SIZE = 25;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An unparseable date would reach the query as an invalid timestamp, so it is dropped here. */
function isoDateOrNull(value: string | undefined): string | null {
  return value && ISO_DATE.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; diagnosis?: string; from?: string; to?: string }>;
}) {
  const membership = await pageMembership();
  const { clientId, diagnosis, from, to } = await searchParams;

  const clientPage = await listClients(membership, {
    limit: 100,
    cursor: null,
    includeArchived: true,
  });
  const knownClientIds = new Set(clientPage.items.map((client) => client.id));

  const filters = {
    clientId: clientId && knownClientIds.has(clientId) ? clientId : null,
    diagnosis:
      diagnosis && (diagnosisSchema.options as readonly string[]).includes(diagnosis)
        ? (diagnosis as Diagnosis)
        : null,
    from: isoDateOrNull(from),
    to: isoDateOrNull(to),
  };

  const page = await listAnalyses(membership, {
    limit: PAGE_SIZE,
    cursor: null,
    clientId: filters.clientId,
    diagnosis: filters.diagnosis,
    from: filters.from,
    to: filters.to,
  });

  const items: AnalysisRow[] = page.items.map((row) => {
    const summary = toAnalysisSummary(row);
    return {
      id: summary.id,
      clientId: summary.clientId,
      clientName: summary.clientName,
      reportId: summary.reportId,
      reportLabel: summary.reportLabel,
      complaintId: summary.complaintId,
      parentAnalysisId: summary.parentAnalysisId,
      diagnosis: summary.diagnosis as Diagnosis,
      headline: summary.headline,
      evidenceStrength: summary.evidenceStrength,
      createdAt: summary.createdAt,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight text-ink">Analysis history</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Every saved analysis, shown as it was stored
        </p>
      </header>

      {/* Remounting on a filter change discards the previously loaded pages,
          which would otherwise stay on screen under the new filters. */}
      <HistoryTable
        key={`${filters.clientId ?? ''}|${filters.diagnosis ?? ''}|${filters.from ?? ''}|${filters.to ?? ''}`}
        clients={clientPage.items.map((client) => ({
          id: client.id,
          name: client.archivedAt ? `${client.name} (archived)` : client.name,
        }))}
        filters={filters}
        initialItems={items}
        initialCursor={page.nextCursor}
      />
    </div>
  );
}
