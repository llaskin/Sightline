import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { analyses, auditEvents, clients, idempotencyRecords } from '../db/schema';
import { ApiError, notFound } from '../http';
import { requireOwner, type MembershipContext } from '../require-membership';

/**
 * Permanent, owner-only deletion of one client and everything belonging to it.
 *
 * The typed name must match exactly, including case. This is destructive and
 * irreversible, so a near-miss is refused rather than interpreted generously.
 */
export async function deleteClient(
  context: MembershipContext,
  clientId: string,
  confirmName: string,
): Promise<{ deleted: true }> {
  const db = getDb();

  // Existence is checked before the role, so a client in another workspace is
  // reported as not found rather than as forbidden.
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, clientId)))
    .limit(1);
  if (!client) throw notFound('That client');

  requireOwner(context);

  if (confirmName !== client.name) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The typed name does not match this client exactly, so nothing was deleted',
      { confirmName: [`Type "${client.name}" exactly, including capitals, to confirm`] },
    );
  }

  await db.transaction(async (tx) => {
    // Every idempotency key pointing at one of this client's analyses or
    // reports is removed too, so a retry cannot replay a key whose result is
    // gone. Done before the cascade, while those ids are still resolvable.
    const analysisIds = await tx
      .select({ id: analyses.id })
      .from(analyses)
      .where(and(eq(analyses.workspaceId, context.workspaceId), eq(analyses.clientId, clientId)));

    await tx.execute(sql`
      delete from idempotency_records
      where workspace_id = ${context.workspaceId}
        and (result_id in (select id from reports where client_id = ${clientId})
          or result_id in (select id from analyses where client_id = ${clientId}))
    `);
    if (analysisIds.length > 0) {
      await tx.delete(idempotencyRecords).where(
        and(
          eq(idempotencyRecords.workspaceId, context.workspaceId),
          inArray(
            idempotencyRecords.resultId,
            analysisIds.map((row) => row.id),
          ),
        ),
      );
    }

    // Complaints, drafts, reports, analyses and response revisions all cascade
    // from the composite client foreign keys.
    await tx
      .delete(clients)
      .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, clientId)));

    await tx.insert(auditEvents).values({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: 'client.deleted',
      entityType: 'client',
      // The id only. Retaining the name or domain here would defeat the point
      // of the deletion the owner just asked for.
      entityId: clientId,
      metadata: { analysesDeleted: analysisIds.length },
    });
  });

  return { deleted: true };
}
