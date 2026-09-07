import { and, desc, eq, lt, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { reports } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { notFound } from '../http';
import { decodeCursor, paginate, type Page } from './shared';
import { isUuid } from './clients';
import type { NormalizedReport } from '@/domain/report-schema';

/** Committed reports are immutable; there is deliberately no update path. */

export type ReportRecord = typeof reports.$inferSelect;

export async function listReports(
  context: MembershipContext,
  options: { limit: number; cursor: string | null; clientId?: string | null },
): Promise<Page<ReportRecord>> {
  const decoded = decodeCursor(options.cursor);
  const rows = await getDb()
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.workspaceId, context.workspaceId),
        options.clientId && isUuid(options.clientId) ? eq(reports.clientId, options.clientId) : undefined,
        decoded
          ? or(
              lt(reports.createdAt, decoded.createdAt),
              and(eq(reports.createdAt, decoded.createdAt), lt(reports.id, decoded.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(options.limit + 1);
  return paginate(rows, options.limit);
}

export async function findReport(context: MembershipContext, id: string) {
  if (!isUuid(id)) return null;
  const rows = await getDb()
    .select()
    .from(reports)
    .where(and(eq(reports.workspaceId, context.workspaceId), eq(reports.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getReportOrThrow(context: MembershipContext, id: string) {
  const found = await findReport(context, id);
  if (!found) throw notFound('That report');
  return found;
}

/** A listing never returns full snapshots; only the detail route does. */
export function toReportSummary(row: ReportRecord) {
  const snapshot = row.snapshot as NormalizedReport;
  return {
    id: row.id,
    clientId: row.clientId,
    reportLabel: row.reportLabel,
    currentStart: snapshot.metadata.currentStart,
    currentEnd: snapshot.metadata.currentEnd,
    baselineStart: snapshot.metadata.baselineStart,
    baselineEnd: snapshot.metadata.baselineEnd,
    timeZone: snapshot.metadata.timeZone,
    trackingStatus: snapshot.metadata.trackingStatus,
    supersedesReportId: row.supersedesReportId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toReportDetail(row: ReportRecord) {
  return {
    ...toReportSummary(row),
    schemaVersion: row.schemaVersion,
    contentHash: row.contentHash,
    snapshot: row.snapshot,
  };
}
