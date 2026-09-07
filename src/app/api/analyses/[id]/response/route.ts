import { route, ok, readJson } from '@/server/http';
import { getAnalysisDetailOrThrow } from '@/server/repositories/analyses';
import { listRevisions, saveResponse, saveResponseSchema, toResponseView } from '@/server/repositories/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => {
    await getAnalysisDetailOrThrow(membership, id);
    return ok({ items: (await listRevisions(membership, id)).map(toResponseView) });
  })(request, undefined as never);
}

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const input = saveResponseSchema.parse(await readJson(req));
    return ok(toResponseView(await saveResponse(membership, id, input)));
  })(request, undefined as never);
}
