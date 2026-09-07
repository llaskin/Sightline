import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { idempotencyRecords } from './db/schema';
import type { Transaction } from './db/client';
import { ApiError } from './http';

/**
 * Idempotent creation.
 *
 * A key is scoped by workspace and operation. The same key with the same
 * canonical request replays the original result; the same key with a different
 * request is a conflict, because it means two genuinely different actions were
 * given one identity.
 *
 * Concurrency is handled by the unique constraint rather than by a read-then-
 * write race: whichever transaction inserts the key first wins, and the others
 * see the violation and replay.
 */

const UNIQUE_VIOLATION = '23505';

/** Stable hash of a request, independent of key order. */
export function hashRequest(value: unknown): string {
  return createHash('sha256').update(canonicalise(value)).digest('hex');
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

export type IdempotencyOutcome<T> =
  | { replayed: false; resultId: string; value: T }
  | { replayed: true; resultId: string };

/** Looks for an existing record, distinguishing a replay from a conflict. */
export async function findExisting(
  tx: Transaction,
  workspaceId: string,
  operation: string,
  requestKey: string,
  requestHash: string,
): Promise<{ resultId: string } | null> {
  const rows = await tx
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.workspaceId, workspaceId),
        eq(idempotencyRecords.operation, operation),
        eq(idempotencyRecords.requestKey, requestKey),
      ),
    )
    .limit(1);

  const existing = rows[0];
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new ApiError(
      'IDEMPOTENCY_CONFLICT',
      'That request key was already used for a different request. Use a new key for a new action.',
    );
  }
  return { resultId: existing.resultId };
}

/**
 * Records the key inside the same transaction that created the result, so a
 * rollback leaves neither behind.
 */
export async function record(
  tx: Transaction,
  workspaceId: string,
  operation: string,
  requestKey: string,
  requestHash: string,
  resultId: string,
): Promise<void> {
  await tx
    .insert(idempotencyRecords)
    .values({ workspaceId, operation, requestKey, requestHash, resultId });
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (!key || key.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'An Idempotency-Key header is required', {
      'idempotency-key': ['This header is required so a retry cannot create a second record'],
    });
  }
  if (key.length > 200) {
    throw new ApiError('VALIDATION_FAILED', 'The Idempotency-Key header is too long');
  }
  return key;
}
