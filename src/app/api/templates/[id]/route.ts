import { route, ok, readJson, notFound } from '@/server/http';
import { requireOwner } from '@/server/require-membership';
import {
  findTemplate,
  toTemplateView,
  updateTemplate,
  updateTemplateSchema,
} from '@/server/repositories/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => {
    const found = await findTemplate(membership, id);
    if (!found) throw notFound('That template');
    return ok(toTemplateView(found));
  })(request, undefined as never);
}

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    requireOwner(membership);
    const input = updateTemplateSchema.parse(await readJson(req));
    return ok(toTemplateView(await updateTemplate(membership, id, input)));
  })(request, undefined as never);
}
