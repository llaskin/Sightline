import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { clients } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { notFound, revisionConflict } from '../http';
import { decodeCursor, paginate, type Page } from './shared';

/**
 * Client records, always scoped to the session's workspace.
 *
 * The domain is validated and normalised but never fetched. Release 1 needs no
 * outbound HTTP at all, which removes a whole class of request-forgery risk.
 */

const ianaTimeZone = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, { error: 'Enter a valid IANA time zone, for example America/New_York' });

/** Accepts a bare host or a URL, and stores the lowercase host only. */
const domainField = z
  .string()
  .trim()
  .min(1, { error: 'A domain is required' })
  .max(253)
  .transform((raw) => raw.replace(/^https?:\/\//i, '').split('/')[0].replace(/\.$/, '').toLowerCase())
  .refine((host) => /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host), {
    error: 'Enter a domain such as example.com',
  });

export const clientDefinitionsSchema = z
  .object({
    propertyLabel: z.string().max(2000).default(''),
    leadDefinition: z.string().max(2000).default(''),
    leadEventName: z.string().max(2000).nullable().default(null),
    defaultWindowDays: z.number().int().min(7).max(93).default(28),
  })
  .default({ propertyLabel: '', leadDefinition: '', leadEventName: null, defaultWindowDays: 28 });

export const createClientSchema = z.object({
  name: z.string().trim().min(1, { error: 'A client name is required' }).max(200),
  domain: domainField,
  timeZone: ianaTimeZone,
  definitions: clientDefinitionsSchema,
});

export const updateClientSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  domain: domainField.optional(),
  timeZone: ianaTimeZone.optional(),
  definitions: clientDefinitionsSchema.optional(),
  archived: z.boolean().optional(),
  expectedRevision: z.number().int().positive(),
});

export type ClientRecord = typeof clients.$inferSelect;

export async function listClients(
  context: MembershipContext,
  options: { limit: number; cursor: string | null; includeArchived?: boolean },
): Promise<Page<ClientRecord>> {
  const decoded = decodeCursor(options.cursor);
  const rows = await getDb()
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.workspaceId, context.workspaceId),
        options.includeArchived ? undefined : isNull(clients.archivedAt),
        decoded
          ? or(
              lt(clients.createdAt, decoded.createdAt),
              and(eq(clients.createdAt, decoded.createdAt), lt(clients.id, decoded.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(clients.createdAt), desc(clients.id))
    .limit(options.limit + 1);
  return paginate(rows, options.limit);
}

/** Returns null rather than throwing, so callers choose the status. */
export async function findClient(
  context: MembershipContext,
  id: string,
): Promise<ClientRecord | null> {
  if (!isUuid(id)) return null;
  const rows = await getDb()
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getClientOrThrow(
  context: MembershipContext,
  id: string,
): Promise<ClientRecord> {
  const found = await findClient(context, id);
  if (!found) throw notFound('That client');
  return found;
}

export async function createClient(
  context: MembershipContext,
  input: z.infer<typeof createClientSchema>,
): Promise<ClientRecord> {
  const [row] = await getDb()
    .insert(clients)
    .values({
      workspaceId: context.workspaceId,
      name: input.name,
      domain: input.domain,
      timeZone: input.timeZone,
      definitions: input.definitions,
    })
    .returning();
  return row;
}

export async function updateClient(
  context: MembershipContext,
  id: string,
  input: z.infer<typeof updateClientSchema>,
): Promise<ClientRecord> {
  const { expectedRevision, archived, ...fields } = input;

  const patch: Partial<typeof clients.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;

  // The revision is part of the WHERE clause, so a concurrent edit updates zero
  // rows rather than overwriting the other person's change.
  const updated = await getDb()
    .update(clients)
    .set({ ...patch, revision: expectedRevision + 1 })
    .where(
      and(
        eq(clients.workspaceId, context.workspaceId),
        eq(clients.id, id),
        eq(clients.revision, expectedRevision),
      ),
    )
    .returning();

  if (updated.length > 0) return updated[0];

  // Nothing updated: either the caller cannot see the row, or it moved on.
  const existing = await findClient(context, id);
  if (!existing) throw notFound('That client');
  throw revisionConflict(existing.revision);
}

export async function deleteClientRow(context: MembershipContext, id: string): Promise<void> {
  await getDb()
    .delete(clients)
    .where(and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, id)));
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function toClientView(row: ClientRecord) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    timeZone: row.timeZone,
    definitions: row.definitions,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
