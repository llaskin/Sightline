import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { notFound, revisionConflict } from '../http';

/** Workspace settings. Owner-only writes. */

export const updateSettingsSchema = z.object({
  workspaceName: z.string().trim().min(1).max(200).optional(),
  /** null keeps everything until an owner deletes it. */
  retentionDays: z.union([z.literal(90), z.literal(180), z.literal(365), z.null()]).optional(),
  expectedRevision: z.number().int().positive(),
});

export async function readSettings(context: MembershipContext) {
  const rows = await getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, context.workspaceId))
    .limit(1);
  const workspace = rows[0];
  if (!workspace) throw notFound('That workspace');
  return {
    workspaceName: workspace.name,
    retentionDays: workspace.retentionDays,
    revision: workspace.revision,
    role: context.role,
    name: context.userName,
    email: context.userEmail,
  };
}

export async function updateSettings(
  context: MembershipContext,
  input: z.infer<typeof updateSettingsSchema>,
) {
  const { expectedRevision, workspaceName, retentionDays } = input;
  const updated = await getDb()
    .update(workspaces)
    .set({
      ...(workspaceName !== undefined ? { name: workspaceName } : {}),
      ...(retentionDays !== undefined ? { retentionDays } : {}),
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(workspaces.id, context.workspaceId), eq(workspaces.revision, expectedRevision)))
    .returning();

  if (updated.length > 0) return readSettings(context);

  const rows = await getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, context.workspaceId))
    .limit(1);
  if (!rows[0]) throw notFound('That workspace');
  throw revisionConflict(rows[0].revision);
}
