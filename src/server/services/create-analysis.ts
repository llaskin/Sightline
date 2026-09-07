import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  analyses,
  auditEvents,
  clients,
  complaints,
  reports,
  responseRevisions,
  responseTemplates,
} from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { ApiError, notFound } from '../http';
import { findExisting, hashRequest, isUniqueViolation, record } from '../idempotency';
import { analyzeReport } from '@/domain/analyze';
import { renderResponse } from '@/domain/render-response';
import { RULE_VERSION, RESULT_SCHEMA_VERSION } from '@/domain/analysis-schema';
import { complaintInputSchema, type ComplaintInput } from '@/domain/complaint-schema';
import { normalizedReportSchema } from '@/domain/report-schema';

/**
 * Runs the pure engine against stored snapshots and saves the whole outcome in
 * one transaction: the analysis, its first response revision, the complaint's
 * status transition, an audit event and the idempotency record.
 *
 * Release 1 makes no external call, so the transaction is never held open
 * across a network round trip.
 */

export const OPERATION = 'create-analysis';

export type CreateAnalysisInput = {
  reportId: string;
  complaintId: string;
  parentAnalysisId?: string | null;
  templateId?: string | null;
};

export async function createAnalysis(
  context: MembershipContext,
  input: CreateAnalysisInput,
  requestKey: string,
  now: Date = new Date(),
) {
  const requestHash = hashRequest({
    reportId: input.reportId,
    complaintId: input.complaintId,
    parentAnalysisId: input.parentAnalysisId ?? null,
    templateId: input.templateId ?? null,
  });

  try {
    return await getDb().transaction(async (tx) => {
      const replay = await findExisting(tx, context.workspaceId, OPERATION, requestKey, requestHash);
      if (replay) {
        const loaded = await loadAnalysis(tx, context.workspaceId, replay.resultId);
        if (loaded) return { ...loaded, replayed: true };
      }

      const [report] = await tx
        .select()
        .from(reports)
        .where(and(eq(reports.workspaceId, context.workspaceId), eq(reports.id, input.reportId)))
        .limit(1);
      if (!report) throw notFound('That report');

      const [complaint] = await tx
        .select()
        .from(complaints)
        .where(
          and(eq(complaints.workspaceId, context.workspaceId), eq(complaints.id, input.complaintId)),
        )
        .limit(1);
      if (!complaint) throw notFound('That complaint');

      // Both must describe the same client. Without this an analysis could pair
      // one client's evidence with another client's complaint.
      if (report.clientId !== complaint.clientId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'The report and the complaint belong to different clients',
          { complaintId: ['Choose a complaint for the same client as this report'] },
        );
      }

      const [client] = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, report.clientId)))
        .limit(1);
      if (!client) throw notFound('That client');
      if (client.archivedAt !== null) {
        throw new ApiError('CLIENT_ARCHIVED', 'This client is archived. Restore it to analyse.');
      }

      if (input.parentAnalysisId) {
        const [parent] = await tx
          .select()
          .from(analyses)
          .where(
            and(
              eq(analyses.workspaceId, context.workspaceId),
              eq(analyses.id, input.parentAnalysisId),
              eq(analyses.clientId, report.clientId),
            ),
          )
          .limit(1);
        if (!parent) throw notFound('That earlier analysis');
      }

      const template = await resolveTemplate(tx, context.workspaceId, input.templateId ?? null);

      const parsedReport = normalizedReportSchema.parse(report.snapshot);
      const complaintSnapshot: ComplaintInput = complaintInputSchema.parse({
        originalText: complaint.originalText,
        category: complaint.category,
        scope: complaint.scope,
        periodStart: complaint.periodStart,
        periodEnd: complaint.periodEnd,
        receivedAt: complaint.receivedAt.toISOString(),
      });

      const result = analyzeReport(parsedReport, complaintSnapshot, {
        now,
        ruleVersion: RULE_VERSION,
      });

      const { generatedText, templateSnapshot } = renderResponse({
        template: { id: template.id, name: template.name, body: template.body },
        context: {
          clientName: client.name,
          agencyName: context.workspaceName,
          senderName: context.userName,
        },
        report: parsedReport,
        complaint: complaintSnapshot,
        result,
      });

      const [analysis] = await tx
        .insert(analyses)
        .values({
          workspaceId: context.workspaceId,
          clientId: report.clientId,
          reportId: report.id,
          complaintId: complaint.id,
          parentAnalysisId: input.parentAnalysisId ?? null,
          complaintSnapshot,
          ruleVersion: RULE_VERSION,
          resultSchemaVersion: RESULT_SCHEMA_VERSION,
          result,
          diagnosis: result.diagnosis,
          requestKey,
          createdBy: context.userId,
        })
        .returning();

      const [revision] = await tx
        .insert(responseRevisions)
        .values({
          workspaceId: context.workspaceId,
          analysisId: analysis.id,
          revision: 1,
          templateSnapshot,
          generatedText,
          editedText: null,
          createdBy: context.userId,
        })
        .returning();

      // An analysed complaint stays analysed; only a person marks it resolved.
      await tx
        .update(complaints)
        .set({ status: 'analyzed', updatedAt: new Date() })
        .where(
          and(
            eq(complaints.workspaceId, context.workspaceId),
            eq(complaints.id, complaint.id),
            eq(complaints.status, 'open'),
          ),
        );

      await tx.insert(auditEvents).values({
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: 'analysis.created',
        entityType: 'analysis',
        entityId: analysis.id,
        // Classification only; never complaint text or report values.
        metadata: { diagnosis: result.diagnosis, ruleVersion: RULE_VERSION },
      });

      await record(tx, context.workspaceId, OPERATION, requestKey, requestHash, analysis.id);
      return { analysis, revision, client, report, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const loaded = await loadAnalysis(getDb(), context.workspaceId, null, {
        operation: OPERATION,
        requestKey,
      });
      if (loaded) return { ...loaded, replayed: true };
    }
    throw error;
  }
}

type AnyDb = ReturnType<typeof getDb>;

async function resolveTemplate(
  tx: AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0],
  workspaceId: string,
  templateId: string | null,
) {
  if (templateId) {
    const [chosen] = await tx
      .select()
      .from(responseTemplates)
      .where(
        and(eq(responseTemplates.workspaceId, workspaceId), eq(responseTemplates.id, templateId)),
      )
      .limit(1);
    if (!chosen) throw notFound('That response template');
    return chosen;
  }
  const [fallback] = await tx
    .select()
    .from(responseTemplates)
    .where(
      and(eq(responseTemplates.workspaceId, workspaceId), eq(responseTemplates.isDefault, 'true')),
    )
    .limit(1);
  if (!fallback) throw notFound('A default response template');
  return fallback;
}

async function loadAnalysis(
  tx: AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0],
  workspaceId: string,
  analysisId: string | null,
  byKey?: { operation: string; requestKey: string },
) {
  const idCondition = analysisId
    ? eq(analyses.id, analysisId)
    : eq(
        analyses.id,
        sql`(select result_id from idempotency_records where workspace_id = ${workspaceId} and operation = ${byKey!.operation} and request_key = ${byKey!.requestKey})`,
      );

  const [analysis] = await tx
    .select()
    .from(analyses)
    .where(and(eq(analyses.workspaceId, workspaceId), idCondition))
    .limit(1);
  if (!analysis) return null;

  const [revision] = await tx
    .select()
    .from(responseRevisions)
    .where(
      and(
        eq(responseRevisions.workspaceId, workspaceId),
        eq(responseRevisions.analysisId, analysis.id),
      ),
    )
    .orderBy(sql`${responseRevisions.revision} desc`)
    .limit(1);

  const [client] = await tx
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, analysis.clientId)))
    .limit(1);
  const [report] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.workspaceId, workspaceId), eq(reports.id, analysis.reportId)))
    .limit(1);

  return { analysis, revision, client, report };
}
