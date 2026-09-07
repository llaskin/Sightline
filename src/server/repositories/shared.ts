import { and, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { ApiError, notFound, revisionConflict } from '../http';

/**
 * Helpers every scoped repository shares.
 *
 * Two rules hold everywhere: a query is always constrained by the session's
 * workspace, and an update always names the expected revision so a concurrent
 * edit conflicts rather than silently winning.
 */

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Opaque `(createdAt, id)` keyset cursor. Stable under inserts. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | null): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!Number.isFinite(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Keyset predicate for a descending `(createdAt, id)` listing. */
export function keysetWhere(
  cursor: string | null,
  createdAtColumn: never,
  idColumn: never,
): SQL | undefined {
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;
  return or(
    lt(createdAtColumn, decoded.createdAt),
    and(eq(createdAtColumn, decoded.createdAt), lt(idColumn, decoded.id)),
  );
}

export function paginate<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && items.length > 0
      ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
      : null;
  return { items, nextCursor };
}

/**
 * Turns a failed revision-guarded update into the right status.
 *
 * A row the caller cannot see is 404, so an identifier in another workspace is
 * indistinguishable from one that does not exist. A row they can see but whose
 * revision moved on is 409, carrying the current revision so the UI can offer a
 * reconciliation instead of discarding the user's edit.
 */
export async function resolveUpdateFailure(
  existing: { revision: number } | undefined,
  label: string,
): Promise<never> {
  if (!existing) throw notFound(label);
  throw revisionConflict(existing.revision);
}

export function assertArchivedClientAllowsWrites(client: { archivedAt: Date | null }): void {
  if (client.archivedAt !== null) {
    throw new ApiError(
      'CLIENT_ARCHIVED',
      'This client is archived. Restore it before adding new imports, complaints or analyses.',
    );
  }
}

export const nowSql = sql`now()`;
