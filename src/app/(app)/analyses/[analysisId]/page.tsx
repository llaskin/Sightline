import { notFound } from 'next/navigation';
import { desc, eq, and } from 'drizzle-orm';
import { pageMembership } from '@/server/page-data';
import { findAnalysisDetail } from '@/server/repositories/analyses';
import { getDb } from '@/server/db/client';
import { analyses, reports } from '@/server/db/schema';
import { buildDashboardViewModel } from '@/features/dashboard/view-model';
import { Dashboard } from '@/features/dashboard/dashboard';
import { AnalysisSelector } from '@/features/dashboard/report-selector';
import { normalizedReportSchema } from '@/domain/report-schema';
import { complaintInputSchema } from '@/domain/complaint-schema';
import { analysisResultSchema } from '@/domain/analysis-schema';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const membership = await pageMembership();
  const detail = await findAnalysisDetail(membership, analysisId);
  if (!detail) notFound();

  // The stored result is rendered as saved. Nothing is recomputed on read.
  const view = buildDashboardViewModel({
    report: normalizedReportSchema.parse(detail.report.snapshot),
    complaint: complaintInputSchema.parse(detail.analysis.complaintSnapshot),
    result: analysisResultSchema.parse(detail.analysis.result),
    response: detail.revision
      ? {
          revision: detail.revision.revision,
          generatedText: detail.revision.generatedText,
          editedText: detail.revision.editedText,
        }
      : null,
    clientName: detail.client.name,
    clientId: detail.client.id,
    reportLabel: detail.report.reportLabel,
    now: new Date(),
  });

  const siblings = await getDb()
    .select({
      id: analyses.id,
      createdAt: analyses.createdAt,
      reportLabel: reports.reportLabel,
    })
    .from(analyses)
    .innerJoin(
      reports,
      and(eq(reports.workspaceId, analyses.workspaceId), eq(reports.id, analyses.reportId)),
    )
    .where(
      and(
        eq(analyses.workspaceId, membership.workspaceId),
        eq(analyses.clientId, detail.analysis.clientId),
      ),
    )
    .orderBy(desc(analyses.createdAt))
    .limit(25);

  return (
    <Dashboard
      view={view}
      analysisId={analysisId}
      selector={
        <AnalysisSelector
          currentId={analysisId}
          analyses={siblings.map((row) => ({
            id: row.id,
            label: `${row.reportLabel} - analysed ${formatDate(row.createdAt.toISOString().slice(0, 10))}`,
          }))}
        />
      }
    />
  );
}
