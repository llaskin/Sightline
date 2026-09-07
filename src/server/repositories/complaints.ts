import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { complaints } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { notFound, revisionConflict } from '../http';
import { complaintCategorySchema, complaintStatusSchema, MAX_COMPLAINT_TEXT } from '@/domain/complaint-schema';
import { scopeSchema } from '@/domain/report-schema';
import { decodeCursor, paginate, assertArchivedClientAllowsWrites, type Page } from './shared';
import { getClientOrThrow, isUuid } from './clients';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Must be a YYYY-MM-DD date' });

export const createComplaintSchema = z
  .object({
    clientId: z.string(),
    originalText: z.string().trim().min(1, { error: 'The complaint text is required' }).max(MAX_COMPLAINT_TEXT),
    category: complaintCategorySchema,
    scope: scopeSchema,
    periodStart: isoDate,
    periodEnd: isoDate,
    receivedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
      error: 'Must be an ISO 8601 timestamp',
    }),
  })
  .superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: 'The complaint period cannot end before it starts',
      });
    }
  });

export const updateComplaintSchema = z.object({
  originalText: z.string().trim().min(1).max(MAX_COMPLAINT_TEXT).optional(),
  category: complaintCategorySchema.optional(),
  scope: scopeSchema.optional(),
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  status: complaintStatusSchema.optional(),
  expectedRevision: z.number().int().positive(),
});

export type ComplaintRecord = typeof complaints.$inferSelect;

export async function listComplaints(
  context: MembershipContext,
  options: {
    limit: number;
    cursor: string | null;
    clientId?: string | null;
    status?: string | null;
    category?: string | null;
  },
): Promise<Page<ComplaintRecord>> {
  const decoded = decodeCursor(options.cursor);
  const rows = await getDb()
    .select()
    .from(complaints)
    .where(
      and(
        eq(complaints.workspaceId, context.workspaceId),
        options.clientId && isUuid(options.clientId) ? eq(complaints.clientId, options.clientId) : undefined,
        options.status ? eq(complaints.status, options.status as 'open') : undefined,
        options.category ? eq(complaints.category, options.category) : undefined,
        decoded
          ? or(
              lt(complaints.createdAt, decoded.createdAt),
              and(eq(complaints.createdAt, decoded.createdAt), lt(complaints.id, decoded.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(complaints.createdAt), desc(complaints.id))
    .limit(options.limit + 1);
  return paginate(rows, options.limit);
}

export async function findComplaint(
  context: MembershipContext,
  id: string,
): Promise<ComplaintRecord | null> {
  if (!isUuid(id)) return null;
  const rows = await getDb()
    .select()
    .from(complaints)
    .where(and(eq(complaints.workspaceId, context.workspaceId), eq(complaints.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getComplaintOrThrow(context: MembershipContext, id: string) {
  const found = await findComplaint(context, id);
  if (!found) throw notFound('That complaint');
  return found;
}

export async function createComplaint(
  context: MembershipContext,
  input: z.infer<typeof createComplaintSchema>,
): Promise<ComplaintRecord> {
  // Scope is checked here as well as by the composite foreign key.
  const client = await getClientOrThrow(context, input.clientId);
  assertArchivedClientAllowsWrites(client);

  const [row] = await getDb()
    .insert(complaints)
    .values({
      workspaceId: context.workspaceId,
      clientId: client.id,
      originalText: input.originalText,
      category: input.category,
      scope: input.scope,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      receivedAt: new Date(input.receivedAt),
      status: 'open',
      createdBy: context.userId,
    })
    .returning();
  return row;
}

export async function updateComplaint(
  context: MembershipContext,
  id: string,
  input: z.infer<typeof updateComplaintSchema>,
): Promise<ComplaintRecord> {
  const { expectedRevision, ...fields } = input;

  const updated = await getDb()
    .update(complaints)
    .set({ ...fields, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(complaints.workspaceId, context.workspaceId),
        eq(complaints.id, id),
        eq(complaints.revision, expectedRevision),
      ),
    )
    .returning();

  if (updated.length > 0) return updated[0];
  const existing = await findComplaint(context, id);
  if (!existing) throw notFound('That complaint');
  throw revisionConflict(existing.revision);
}

/** Called by createAnalysis. An analysed complaint is never auto-resolved. */
export async function markAnalyzed(
  tx: { update: typeof getDb extends never ? never : ReturnType<typeof getDb>['update'] },
  workspaceId: string,
  complaintId: string,
): Promise<void> {
  await tx
    .update(complaints)
    .set({ status: 'analyzed', updatedAt: new Date() })
    .where(
      and(
        eq(complaints.workspaceId, workspaceId),
        eq(complaints.id, complaintId),
        eq(complaints.status, 'open'),
      ),
    );
}

export function toComplaintView(row: ComplaintRecord) {
  return {
    id: row.id,
    clientId: row.clientId,
    originalText: row.originalText,
    category: row.category,
    scope: row.scope,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    receivedAt: row.receivedAt.toISOString(),
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}
