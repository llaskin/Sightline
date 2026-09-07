import { and, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  analyses,
  auditEvents,
  idempotencyRecords,
  importDrafts,
  reports,
  workspaces,
} from '../db/schema';

/**
 * Data lifecycle.
 *
 * The cutoff clock is injected rather than read from `Date.now()` inside, so a
 * boundary can be tested exactly instead of approximately.
 *
 * Order matters: analyses go first, then reports that no *retained* analysis
 * still references. Deleting reports first would orphan a retained analysis, so
 * that sequence is deliberate rather than incidental.
 */

export type RetentionCounts = {
  analysesDeleted: number;
  reportsDeleted: number;
  idempotencyRecordsDeleted: number;
};

export type RetentionOptions = { now: Date; batchSize?: number };

const DAY_MS = 86_400_000;

/** Workspaces with a retention setting, and the cutoff each one implies. */
async function workspacesWithCutoff(now: Date) {
  const rows = await getDb()
    .select({ id: workspaces.id, retentionDays: workspaces.retentionDays })
    .from(workspaces)
    .where(isNotNull(workspaces.retentionDays));

  return rows.map((row) => ({
    workspaceId: row.id,
    // A record is deleted only once it is *older* than the window, so a record
    // exactly at the boundary is retained.
    cutoff: new Date(now.getTime() - row.retentionDays! * DAY_MS),
  }));
}

async function expiredAnalysisIds(workspaceId: string, cutoff: Date, limit: number) {
  const rows = await getDb()
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(eq(analyses.workspaceId, workspaceId), lt(analyses.createdAt, cutoff)))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Old reports with no surviving analysis pointing at them. */
async function unreferencedReportIds(workspaceId: string, cutoff: Date, limit: number) {
  const referenced = await getDb()
    .select({ reportId: analyses.reportId })
    .from(analyses)
    .where(eq(analyses.workspaceId, workspaceId));
  const keep = referenced.map((row) => row.reportId);

  const rows = await getDb()
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.workspaceId, workspaceId),
        lt(reports.createdAt, cutoff),
        keep.length > 0 ? notInArray(reports.id, keep) : undefined,
      ),
    )
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Counts what retention would remove, without changing anything. */
export async function retentionPreview(options: RetentionOptions): Promise<RetentionCounts> {
  const batchSize = options.batchSize ?? 500;
  const counts: RetentionCounts = {
    analysesDeleted: 0,
    reportsDeleted: 0,
    idempotencyRecordsDeleted: 0,
  };

  for (const { workspaceId, cutoff } of await workspacesWithCutoff(options.now)) {
    const analysisIds = await expiredAnalysisIds(workspaceId, cutoff, batchSize);
    counts.analysesDeleted += analysisIds.length;

    // Reports are counted as they would be *after* those analyses were removed.
    const stillReferenced = await getDb()
      .select({ reportId: analyses.reportId })
      .from(analyses)
      .where(
        and(
          eq(analyses.workspaceId, workspaceId),
          analysisIds.length > 0 ? notInArray(analyses.id, analysisIds) : undefined,
        ),
      );
    const keep = stillReferenced.map((row) => row.reportId);

    const reportRows = await getDb()
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.workspaceId, workspaceId),
          lt(reports.createdAt, cutoff),
          keep.length > 0 ? notInArray(reports.id, keep) : undefined,
        ),
      )
      .limit(batchSize);
    counts.reportsDeleted += reportRows.length;
  }

  const orphaned = await orphanedIdempotencyIds();
  counts.idempotencyRecordsDeleted = orphaned.length;
  return counts;
}

/**
 * Idempotency rows whose result no longer exists. Keeping them would let a
 * retried request replay a key pointing at a deleted record.
 */
async function orphanedIdempotencyIds(): Promise<string[]> {
  const rows = await getDb().execute<{ id: string }>(sql`
    select ir.id
    from idempotency_records ir
    where not exists (select 1 from analyses a where a.id = ir.result_id)
      and not exists (select 1 from reports r where r.id = ir.result_id)
  `);
  return [...rows].map((row) => row.id);
}

export async function applyRetention(options: RetentionOptions): Promise<RetentionCounts> {
  const batchSize = options.batchSize ?? 500;
  const counts: RetentionCounts = {
    analysesDeleted: 0,
    reportsDeleted: 0,
    idempotencyRecordsDeleted: 0,
  };
  const db = getDb();

  for (const { workspaceId, cutoff } of await workspacesWithCutoff(options.now)) {
    // Batched so one enormous workspace cannot hold a single long transaction.
    for (;;) {
      const analysisIds = await expiredAnalysisIds(workspaceId, cutoff, batchSize);
      if (analysisIds.length === 0) break;
      await db.transaction(async (tx) => {
        // Response revisions cascade from the analysis foreign key.
        await tx
          .delete(analyses)
          .where(and(eq(analyses.workspaceId, workspaceId), inArray(analyses.id, analysisIds)));
      });
      counts.analysesDeleted += analysisIds.length;
      if (analysisIds.length < batchSize) break;
    }

    for (;;) {
      const reportIds = await unreferencedReportIds(workspaceId, cutoff, batchSize);
      if (reportIds.length === 0) break;
      await db.transaction(async (tx) => {
        await tx
          .delete(reports)
          .where(and(eq(reports.workspaceId, workspaceId), inArray(reports.id, reportIds)));
      });
      counts.reportsDeleted += reportIds.length;
      if (reportIds.length < batchSize) break;
    }

    if (counts.analysesDeleted > 0 || counts.reportsDeleted > 0) {
      await db.insert(auditEvents).values({
        workspaceId,
        actorId: null,
        action: 'retention.applied',
        entityType: 'workspace',
        entityId: workspaceId,
        // Counts only; nothing identifying what was removed.
        metadata: {
          analysesDeleted: counts.analysesDeleted,
          reportsDeleted: counts.reportsDeleted,
          cutoff: cutoff.toISOString(),
        },
      });
    }
  }

  const orphaned = await orphanedIdempotencyIds();
  if (orphaned.length > 0) {
    await db.delete(idempotencyRecords).where(inArray(idempotencyRecords.id, orphaned));
    counts.idempotencyRecordsDeleted = orphaned.length;
  }

  return counts;
}

/** Abandoned drafts expire on their own schedule, independent of retention. */
export async function expireDrafts(options: {
  now: Date;
  dryRun?: boolean;
}): Promise<{ draftsDeleted: number }> {
  const db = getDb();
  const expired = await db
    .select({ id: importDrafts.id })
    .from(importDrafts)
    .where(lt(importDrafts.expiresAt, options.now));

  if (expired.length === 0 || options.dryRun) return { draftsDeleted: expired.length };

  await db.delete(importDrafts).where(
    inArray(
      importDrafts.id,
      expired.map((row) => row.id),
    ),
  );
  return { draftsDeleted: expired.length };
}
