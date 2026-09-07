import { z } from 'zod';
import { route, ok, readJson } from '@/server/http';
import { toDraftView, validateDraft } from '@/server/repositories/imports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ expectedRevision: z.number().int().positive() });
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const { expectedRevision } = schema.parse(await readJson(req));
    const { draft, validation } = await validateDraft(membership, id, expectedRevision);
    return ok({ ...toDraftView(draft), ...validation });
  })(request, undefined as never);
}
