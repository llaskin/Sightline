import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { importDrafts } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { notFound, revisionConflict } from '../http';
import { normalizeDraft } from '@/features/imports/normalize';
import type { RowError } from '@/features/imports/csv';
import { assertArchivedClientAllowsWrites } from './shared';
import { getClientOrThrow, isUuid } from './clients';

/**
 * Import drafts.
 *
 * Any edit resets the draft to `draft` and clears its validated content hash,
 * so a commit can never use a hash that was computed from different content.
 */

export const DRAFT_TTL_DAYS = 7;
export const MAX_REPORTED_ERRORS = 100;

export const createDraftSchema = z.object({ clientId: z.string() });

/** Everything the wizard can save. Validated fully only at validate/commit. */
export const patchDraftSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .catchall(z.unknown());

export type DraftRecord = typeof importDrafts.$inferSelect;

export type DraftPayload = {
  metadata?: unknown;
  datasets?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  selectedForm?: unknown;
  formDefinitionAcknowledged?: unknown;
  trendGranularity?: unknown;
  /** Provenance of uploaded files. The original bytes are not retained. */
  files?: Record<string, { name: string; contentHash: string; byteCount: number; rowCount: number }>;
};

/** Canonical hash of the exact content a commit will turn into a report. */
export function hashPayload(payload: DraftPayload): string {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** Builds the report candidate a draft describes. */
export function candidateFromPayload(payload: DraftPayload) {
  return {
    schemaVersion: 1,
    metadata: payload.metadata,
    datasets: payload.datasets ?? {},
    sources: payload.sources ?? {},
    selectedForm: payload.selectedForm ?? null,
    formDefinitionAcknowledged: payload.formDefinitionAcknowledged ?? false,
    trendGranularity: payload.trendGranularity ?? null,
  };
}

export function validatePayload(payload: DraftPayload): {
  ok: boolean;
  errors: RowError[];
  totalErrorCount: number;
} {
  const result = normalizeDraft(candidateFromPayload(payload));
  if (result.ok) return { ok: true, errors: [], totalErrorCount: 0 };
  return {
    ok: false,
    errors: result.errors.slice(0, MAX_REPORTED_ERRORS),
    totalErrorCount: result.errors.length,
  };
}

export async function createDraft(
  context: MembershipContext,
  input: z.infer<typeof createDraftSchema>,
): Promise<DraftRecord> {
  const client = await getClientOrThrow(context, input.clientId);
  assertArchivedClientAllowsWrites(client);

  const expiresAt = new Date(Date.now() + DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await getDb()
    .insert(importDrafts)
    .values({
      workspaceId: context.workspaceId,
      clientId: client.id,
      payload: {},
      expiresAt,
      createdBy: context.userId,
    })
    .returning();
  return row;
}

export async function findDraft(
  context: MembershipContext,
  id: string,
): Promise<DraftRecord | null> {
  if (!isUuid(id)) return null;
  const rows = await getDb()
    .select()
    .from(importDrafts)
    .where(and(eq(importDrafts.workspaceId, context.workspaceId), eq(importDrafts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDraftOrThrow(context: MembershipContext, id: string) {
  const found = await findDraft(context, id);
  if (!found || found.state === 'deleted') throw notFound('That import draft');
  return found;
}

export async function patchDraft(
  context: MembershipContext,
  id: string,
  input: Record<string, unknown>,
): Promise<DraftRecord> {
  const expectedRevision = input.expectedRevision as number;
  const { expectedRevision: _ignored, ...payloadFields } = input;
  void _ignored;

  const existingDraft = await getDraftOrThrow(context, id);
  const payload = { ...(existingDraft.payload as DraftPayload), ...payloadFields };

  // Any edit invalidates the previous validation. The hash is cleared so a
  // commit carrying the old hash cannot succeed against changed content.
  const updated = await getDb()
    .update(importDrafts)
    .set({
      payload,
      state: 'draft',
      contentHash: null,
      validation: null,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(importDrafts.workspaceId, context.workspaceId),
        eq(importDrafts.id, id),
        eq(importDrafts.revision, expectedRevision),
        // A validated draft may still be edited; the edit resets it to draft
        // and clears the hash. Only a committed or deleted draft is closed.
        inArray(importDrafts.state, ['draft', 'validated']),
      ),
    )
    .returning();

  if (updated.length > 0) return updated[0];

  const current = await findDraft(context, id);
  if (!current) throw notFound('That import draft');
  throw revisionConflict(current.revision);
}

export async function validateDraft(
  context: MembershipContext,
  id: string,
  expectedRevision: number,
): Promise<{ draft: DraftRecord; validation: ReturnType<typeof validatePayload> }> {
  const draft = await getDraftOrThrow(context, id);
  const payload = draft.payload as DraftPayload;
  const validation = validatePayload(payload);

  const updated = await getDb()
    .update(importDrafts)
    .set({
      state: validation.ok ? 'validated' : 'draft',
      // Recorded only for content that actually passed validation.
      contentHash: validation.ok ? hashPayload(payload) : null,
      validation,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(importDrafts.workspaceId, context.workspaceId),
        eq(importDrafts.id, id),
        eq(importDrafts.revision, expectedRevision),
      ),
    )
    .returning();

  if (updated.length === 0) throw revisionConflict(draft.revision);
  return { draft: updated[0], validation };
}

export async function deleteDraft(context: MembershipContext, id: string): Promise<void> {
  await getDb()
    .update(importDrafts)
    .set({ state: 'deleted', updatedAt: new Date() })
    .where(and(eq(importDrafts.workspaceId, context.workspaceId), eq(importDrafts.id, id)));
}

export function toDraftView(row: DraftRecord) {
  return {
    id: row.id,
    clientId: row.clientId,
    payload: row.payload,
    state: row.state,
    contentHash: row.contentHash,
    validation: row.validation,
    revision: row.revision,
    expiresAt: row.expiresAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
