import { and, desc, eq, gte, lte, lt, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { analyses, clients, reports, responseRevisions } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { notFound } from '../http';
import { decodeCursor, paginate, type Page } from './shared';
import { isUuid } from './clients';
import type { AnalysisResult } from '@/domain/analysis-schema';
import type { NormalizedReport } from '@/domain/report-schema';

/**
 * Saved analyses. A read returns exactly what was stored; today's rules are
 * never re-run against a historical record.
 */

export type AnalysisRecord = typeof analyses.$inferSelect;

export async function listAnalyses(
  context: MembershipContext,
  options: {
    limit: number;
    cursor: string | null;
    clientId?: string | null;
    diagnosis?: string | null;
    from?: string | null;
    to?: string | null;
  },
): Promise<Page<AnalysisRecord & { clientName: string; reportLabel: string }>> {
  const decoded = decodeCursor(options.cursor);
  const rows = await getDb()
    .select({
      analysis: analyses,
      clientName: clients.name,
      reportLabel: reports.reportLabel,
    })
    .from(analyses)
    .innerJoin(
      clients,
      and(eq(clients.workspaceId, analyses.workspaceId), eq(clients.id, analyses.clientId)),
    )
    .innerJoin(
      reports,
      and(eq(reports.workspaceId, analyses.workspaceId), eq(reports.id, analyses.reportId)),
    )
    .where(
      and(
        eq(analyses.workspaceId, context.workspaceId),
        options.clientId && isUuid(options.clientId) ? eq(analyses.clientId, options.clientId) : undefined,
        options.diagnosis ? eq(analyses.diagnosis, options.diagnosis) : undefined,
        options.from ? gte(analyses.createdAt, new Date(options.from)) : undefined,
        options.to ? lte(analyses.createdAt, new Date(`${options.to}T23:59:59.999Z`)) : undefined,
        decoded
          ? or(
              lt(analyses.createdAt, decoded.createdAt),
              and(eq(analyses.createdAt, decoded.createdAt), lt(analyses.id, decoded.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(analyses.createdAt), desc(analyses.id))
    .limit(options.limit + 1);

  const flattened = rows.map((row) => ({
    ...row.analysis,
    clientName: row.clientName,
    reportLabel: row.reportLabel,
  }));
  return paginate(flattened, options.limit);
}

export async function findAnalysisDetail(context: MembershipContext, id: string) {
  if (!isUuid(id)) return null;
  const rows = await getDb()
    .select({ analysis: analyses, client: clients, report: reports })
    .from(analyses)
    .innerJoin(
      clients,
      and(eq(clients.workspaceId, analyses.workspaceId), eq(clients.id, analyses.clientId)),
    )
    .innerJoin(
      reports,
      and(eq(reports.workspaceId, analyses.workspaceId), eq(reports.id, analyses.reportId)),
    )
    .where(and(eq(analyses.workspaceId, context.workspaceId), eq(analyses.id, id)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [revision] = await getDb()
    .select()
    .from(responseRevisions)
    .where(
      and(
        eq(responseRevisions.workspaceId, context.workspaceId),
        eq(responseRevisions.analysisId, id),
      ),
    )
    .orderBy(desc(responseRevisions.revision))
    .limit(1);

  return { ...row, revision };
}

export async function getAnalysisDetailOrThrow(context: MembershipContext, id: string) {
  const found = await findAnalysisDetail(context, id);
  if (!found) throw notFound('That analysis');
  return found;
}

/** A listing never carries a full result snapshot. */
export function toAnalysisSummary(
  row: AnalysisRecord & { clientName: string; reportLabel: string },
) {
  const result = row.result as AnalysisResult;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    reportId: row.reportId,
    reportLabel: row.reportLabel,
    complaintId: row.complaintId,
    parentAnalysisId: row.parentAnalysisId,
    diagnosis: row.diagnosis,
    headline: result.headline,
    complaintAssessment: result.complaintAssessment,
    evidenceStrength: result.evidenceStrength,
    ruleVersion: row.ruleVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAnalysisDetail(detail: NonNullable<Awaited<ReturnType<typeof findAnalysisDetail>>>) {
  const { analysis, client, report, revision } = detail;
  return {
    id: analysis.id,
    clientId: analysis.clientId,
    clientName: client.name,
    clientDomain: client.domain,
    reportId: analysis.reportId,
    reportLabel: report.reportLabel,
    complaintId: analysis.complaintId,
    parentAnalysisId: analysis.parentAnalysisId,
    complaintSnapshot: analysis.complaintSnapshot,
    diagnosis: analysis.diagnosis,
    ruleVersion: analysis.ruleVersion,
    resultSchemaVersion: analysis.resultSchemaVersion,
    result: analysis.result as AnalysisResult,
    reportSnapshot: report.snapshot as NormalizedReport,
    createdAt: analysis.createdAt.toISOString(),
    response: revision
      ? {
          revision: revision.revision,
          generatedText: revision.generatedText,
          editedText: revision.editedText,
          templateSnapshot: revision.templateSnapshot,
          createdAt: revision.createdAt.toISOString(),
        }
      : null,
  };
}
