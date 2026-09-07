import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { auditEvents, clients, importDrafts, reports } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { ApiError, notFound } from '../http';
import { findExisting, hashRequest, isUniqueViolation, record } from '../idempotency';
import { candidateFromPayload, hashPayload, type DraftPayload } from '../repositories/imports';
import { normalizeDraft } from '@/features/imports/normalize';

/**
 * Turns a validated draft into an immutable report, in one transaction.
 *
 * Either everything is written - report, draft state, audit event, idempotency
 * record - or nothing is. No external call happens inside the transaction, so
 * it is never held open waiting on a network.
 */

export const OPERATION = 'commit-import';

export type CommitInput = {
  draftId: string;
  expectedRevision: number;
  contentHash: string;
  supersedesReportId?: string | null;
};

export async function commitImport(
  context: MembershipContext,
  input: CommitInput,
  requestKey: string,
): Promise<{ report: typeof reports.$inferSelect; replayed: boolean }> {
  const requestHash = hashRequest({
    draftId: input.draftId,
    contentHash: input.contentHash,
    supersedesReportId: input.supersedesReportId ?? null,
  });

  try {
    return await getDb().transaction(async (tx) => {
      // Take the draft lock *first*. Concurrent commits queue here, and each
      // one that proceeds does so only after the previous has committed. The
      // idempotency lookup then happens under the lock, so a waiting caller
      // sees the winner's record instead of racing past it and failing the
      // revision check. Checking the key before the lock would make every
      // loser return 409 rather than replaying the one real result.
      const [draft] = await tx
        .select()
        .from(importDrafts)
        .where(
          and(eq(importDrafts.workspaceId, context.workspaceId), eq(importDrafts.id, input.draftId)),
        )
        .limit(1)
        .for('update');

      if (!draft || draft.state === 'deleted') throw notFound('That import draft');

      const replay = await findExisting(tx, context.workspaceId, OPERATION, requestKey, requestHash);
      if (replay) {
        const [existing] = await tx
          .select()
          .from(reports)
          .where(and(eq(reports.workspaceId, context.workspaceId), eq(reports.id, replay.resultId)))
          .limit(1);
        if (existing) return { report: existing, replayed: true };
      }

      if (draft.revision !== input.expectedRevision) {
        throw new ApiError(
          'REVISION_CONFLICT',
          'This draft changed since you validated it. Review and validate it again.',
          undefined,
          { latestRevision: draft.revision },
        );
      }
      if (draft.state !== 'validated' || draft.contentHash === null) {
        throw new ApiError('CONFLICT', 'Validate this draft before committing it');
      }
      if (draft.contentHash !== input.contentHash) {
        throw new ApiError('CONFLICT', 'This draft changed since you validated it');
      }
      if (draft.expiresAt.getTime() <= Date.now()) {
        throw new ApiError('CONFLICT', 'This draft has expired. Start a new import.');
      }

      const payload = draft.payload as DraftPayload;
      // The hash is recomputed rather than trusted, so a tampered stored hash
      // cannot let altered content through.
      if (hashPayload(payload) !== draft.contentHash) {
        throw new ApiError('CONFLICT', 'This draft changed since you validated it');
      }

      const normalised = normalizeDraft(candidateFromPayload(payload));
      if (!normalised.ok) {
        throw new ApiError('VALIDATION_FAILED', 'This draft is no longer valid', {
          draft: normalised.errors.slice(0, 20).map((error) => error.message),
        });
      }

      const [client] = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, draft.clientId)))
        .limit(1);
      if (!client) throw notFound('That client');
      if (client.archivedAt !== null) {
        throw new ApiError('CLIENT_ARCHIVED', 'This client is archived. Restore it to import.');
      }

      // A correction must supersede a report for the *same* client.
      if (input.supersedesReportId) {
        const [predecessor] = await tx
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.workspaceId, context.workspaceId),
              eq(reports.id, input.supersedesReportId),
              eq(reports.clientId, draft.clientId),
            ),
          )
          .limit(1);
        if (!predecessor) throw notFound('That report being corrected');
      }

      const [report] = await tx
        .insert(reports)
        .values({
          workspaceId: context.workspaceId,
          clientId: draft.clientId,
          schemaVersion: normalised.report.schemaVersion,
          reportLabel: normalised.report.metadata.reportLabel,
          snapshot: normalised.report,
          supersedesReportId: input.supersedesReportId ?? null,
          contentHash: draft.contentHash,
          createdBy: context.userId,
        })
        .returning();

      await tx
        .update(importDrafts)
        .set({ state: 'committed', updatedAt: new Date() })
        .where(eq(importDrafts.id, draft.id));

      await tx.insert(auditEvents).values({
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: 'report.committed',
        entityType: 'report',
        entityId: report.id,
        // Counts only. No report rows, complaint text or source values.
        metadata: {
          clientId: draft.clientId,
          corrected: Boolean(input.supersedesReportId),
        },
      });

      await record(tx, context.workspaceId, OPERATION, requestKey, requestHash, report.id);
      return { report, replayed: false };
    });
  } catch (error) {
    // Another transaction inserted the same key first: replay its result.
    if (isUniqueViolation(error)) {
      const [existing] = await getDb()
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.workspaceId, context.workspaceId),
            eq(
              reports.id,
              sql`(select result_id from idempotency_records where workspace_id = ${context.workspaceId} and operation = ${OPERATION} and request_key = ${requestKey})`,
            ),
          ),
        )
        .limit(1);
      if (existing) return { report: existing, replayed: true };
    }
    throw error;
  }
}
