import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { responseTemplates } from '../db/schema';
import type { MembershipContext } from '../require-membership';
import { ApiError, notFound, revisionConflict } from '../http';
import { validateTemplate, MAX_TEMPLATE_LENGTH, DEFAULT_TEMPLATE_BODY } from '@/domain/render-response';
import { isUuid } from './clients';

/** Workspace response templates. Owner-only writes; everyone can read. */

const bodyField = z
  .string()
  .min(1, { error: 'The template cannot be empty' })
  .max(MAX_TEMPLATE_LENGTH)
  .superRefine((value, ctx) => {
    const result = validateTemplate(value);
    for (const error of result.errors) {
      ctx.addIssue({ code: 'custom', message: error.message });
    }
  });

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  body: bodyField,
});

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  body: bodyField.optional(),
  /** Restores the bundled default text. */
  reset: z.boolean().optional(),
  expectedRevision: z.number().int().positive(),
});

export type TemplateRecord = typeof responseTemplates.$inferSelect;

export async function listTemplates(context: MembershipContext): Promise<TemplateRecord[]> {
  return getDb()
    .select()
    .from(responseTemplates)
    .where(eq(responseTemplates.workspaceId, context.workspaceId))
    .orderBy(asc(responseTemplates.createdAt));
}

export async function findTemplate(context: MembershipContext, id: string) {
  if (!isUuid(id)) return null;
  const rows = await getDb()
    .select()
    .from(responseTemplates)
    .where(and(eq(responseTemplates.workspaceId, context.workspaceId), eq(responseTemplates.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** The template an analysis uses when none is chosen explicitly. */
export async function getDefaultTemplate(workspaceId: string): Promise<TemplateRecord> {
  const rows = await getDb()
    .select()
    .from(responseTemplates)
    .where(
      and(
        eq(responseTemplates.workspaceId, workspaceId),
        eq(responseTemplates.isDefault, 'true'),
      ),
    )
    .limit(1);
  if (rows[0]) return rows[0];

  // A workspace should always have one; recreate it rather than fail an analysis.
  const [created] = await getDb()
    .insert(responseTemplates)
    .values({
      workspaceId,
      name: 'Default response',
      body: DEFAULT_TEMPLATE_BODY,
      isDefault: 'true',
      createdBy: 'system',
      updatedBy: 'system',
    })
    .returning();
  return created;
}

export async function createTemplate(
  context: MembershipContext,
  input: z.infer<typeof createTemplateSchema>,
): Promise<TemplateRecord> {
  const [row] = await getDb()
    .insert(responseTemplates)
    .values({
      workspaceId: context.workspaceId,
      name: input.name,
      body: input.body,
      isDefault: 'false',
      createdBy: context.userId,
      updatedBy: context.userId,
    })
    .returning();
  return row;
}

export async function updateTemplate(
  context: MembershipContext,
  id: string,
  input: z.infer<typeof updateTemplateSchema>,
): Promise<TemplateRecord> {
  const { expectedRevision, reset, ...fields } = input;
  const body = reset ? DEFAULT_TEMPLATE_BODY : fields.body;
  if (body !== undefined) {
    const validation = validateTemplate(body);
    if (!validation.valid) {
      throw new ApiError('VALIDATION_FAILED', validation.errors[0].message, {
        body: validation.errors.map((error) => error.message),
      });
    }
  }

  // Editing a template never rewrites a response revision that already
  // snapshotted it; those snapshots are stored with the revision itself.
  const updated = await getDb()
    .update(responseTemplates)
    .set({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(body !== undefined ? { body } : {}),
      revision: expectedRevision + 1,
      updatedBy: context.userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(responseTemplates.workspaceId, context.workspaceId),
        eq(responseTemplates.id, id),
        eq(responseTemplates.revision, expectedRevision),
      ),
    )
    .returning();

  if (updated.length > 0) return updated[0];
  const existing = await findTemplate(context, id);
  if (!existing) throw notFound('That template');
  throw revisionConflict(existing.revision);
}

export function toTemplateView(row: TemplateRecord) {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    isDefault: row.isDefault === 'true',
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}
