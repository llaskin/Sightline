import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { analyses, clients, responseRevisions, responseTemplates } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { ApiError, notFound, revisionConflict } from '../http';
import { renderResponse } from '@/domain/render-response';
import { analysisResultSchema } from '@/domain/analysis-schema';
import { complaintInputSchema } from '@/domain/complaint-schema';
import { normalizedReportSchema } from '@/domain/report-schema';
import { reports } from '../db/schema';

/**
 * Response drafts.
 *
 * Every save appends a new revision rather than overwriting, and the generated
 * text is stored separately from the edited text, so an agency edit never
 * destroys what the engine actually said. A unique `(analysisId, revision)`
 * constraint plus a locked read means two simultaneous saves cannot both
 * succeed.
 */

export const MAX_DRAFT_LENGTH = 10_000;

export const saveResponseSchema = z.object({
  editedText: z.string().max(MAX_DRAFT_LENGTH),
  expectedRevision: z.number().int().positive(),
});

export const regenerateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  templateId: z.string().nullable().optional(),
});

async function latestRevision(workspaceId: string, analysisId: string) {
  const [row] = await getDb()
    .select()
    .from(responseRevisions)
    .where(
      and(
        eq(responseRevisions.workspaceId, workspaceId),
        eq(responseRevisions.analysisId, analysisId),
      ),
    )
    .orderBy(desc(responseRevisions.revision))
    .limit(1);
  return row ?? null;
}

export async function saveResponse(
  context: MembershipContext,
  analysisId: string,
  input: z.infer<typeof saveResponseSchema>,
) {
  return getDb().transaction(async (tx) => {
    // Lock the analysis so two saves serialise rather than racing.
    const [analysis] = await tx
      .select()
      .from(analyses)
      .where(and(eq(analyses.workspaceId, context.workspaceId), eq(analyses.id, analysisId)))
      .limit(1)
      .for('update');
    if (!analysis) throw notFound('That analysis');

    const [current] = await tx
      .select()
      .from(responseRevisions)
      .where(
        and(
          eq(responseRevisions.workspaceId, context.workspaceId),
          eq(responseRevisions.analysisId, analysisId),
        ),
      )
      .orderBy(desc(responseRevisions.revision))
      .limit(1);
    if (!current) throw notFound('That response');

    if (current.revision !== input.expectedRevision) {
      // The caller's local text is not discarded; the client is handed the
      // server's version so a person can reconcile the two.
      throw new ApiError(
        'REVISION_CONFLICT',
        'Someone else saved this draft while you were editing it',
        undefined,
        {
          latestRevision: current.revision,
          serverText: current.editedText ?? current.generatedText,
        },
      );
    }

    const [saved] = await tx
      .insert(responseRevisions)
      .values({
        workspaceId: context.workspaceId,
        analysisId,
        revision: current.revision + 1,
        // The generated text is carried forward untouched.
        templateSnapshot: current.templateSnapshot,
        generatedText: current.generatedText,
        editedText: input.editedText,
        createdBy: context.userId,
      })
      .returning();
    return saved;
  });
}

export async function regenerateResponse(
  context: MembershipContext,
  analysisId: string,
  input: z.infer<typeof regenerateSchema>,
) {
  return getDb().transaction(async (tx) => {
    const [analysis] = await tx
      .select()
      .from(analyses)
      .where(and(eq(analyses.workspaceId, context.workspaceId), eq(analyses.id, analysisId)))
      .limit(1)
      .for('update');
    if (!analysis) throw notFound('That analysis');

    const [current] = await tx
      .select()
      .from(responseRevisions)
      .where(
        and(
          eq(responseRevisions.workspaceId, context.workspaceId),
          eq(responseRevisions.analysisId, analysisId),
        ),
      )
      .orderBy(desc(responseRevisions.revision))
      .limit(1);
    if (!current) throw notFound('That response');
    if (current.revision !== input.expectedRevision) {
      throw new ApiError(
        'REVISION_CONFLICT',
        'Someone else saved this draft while you were editing it',
        undefined,
        {
          latestRevision: current.revision,
          serverText: current.editedText ?? current.generatedText,
        },
      );
    }

    const template = input.templateId
      ? (
          await tx
            .select()
            .from(responseTemplates)
            .where(
              and(
                eq(responseTemplates.workspaceId, context.workspaceId),
                eq(responseTemplates.id, input.templateId),
              ),
            )
            .limit(1)
        )[0]
      : (
          await tx
            .select()
            .from(responseTemplates)
            .where(
              and(
                eq(responseTemplates.workspaceId, context.workspaceId),
                eq(responseTemplates.isDefault, 'true'),
              ),
            )
            .limit(1)
        )[0];
    if (!template) throw notFound('That response template');

    const [client] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, analysis.clientId)))
      .limit(1);
    const [report] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.workspaceId, context.workspaceId), eq(reports.id, analysis.reportId)))
      .limit(1);
    if (!client || !report) throw notFound('That analysis');

    // Regeneration renders from the *saved* result. It never re-runs the rules,
    // so a regenerated draft cannot silently change a historical finding.
    const { generatedText, templateSnapshot } = renderResponse({
      template: { id: template.id, name: template.name, body: template.body },
      context: {
        clientName: client.name,
        agencyName: context.workspaceName,
        senderName: context.userName,
      },
      report: normalizedReportSchema.parse(report.snapshot),
      complaint: complaintInputSchema.parse(analysis.complaintSnapshot),
      result: analysisResultSchema.parse(analysis.result),
    });

    const [saved] = await tx
      .insert(responseRevisions)
      .values({
        workspaceId: context.workspaceId,
        analysisId,
        revision: current.revision + 1,
        templateSnapshot,
        generatedText,
        editedText: null,
        createdBy: context.userId,
      })
      .returning();
    return saved;
  });
}

export async function listRevisions(context: MembershipContext, analysisId: string) {
  return getDb()
    .select()
    .from(responseRevisions)
    .where(
      and(
        eq(responseRevisions.workspaceId, context.workspaceId),
        eq(responseRevisions.analysisId, analysisId),
      ),
    )
    .orderBy(desc(responseRevisions.revision));
}

export function toResponseView(row: typeof responseRevisions.$inferSelect) {
  return {
    revision: row.revision,
    generatedText: row.generatedText,
    editedText: row.editedText,
    /** Labels the draft honestly once a person has changed it. */
    isEdited: row.editedText !== null,
    templateSnapshot: row.templateSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

export { latestRevision, revisionConflict };
