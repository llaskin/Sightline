import { route, ok, readJson } from '@/server/http';
import { regenerateResponse, regenerateSchema, toResponseView } from '@/server/repositories/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const input = regenerateSchema.parse(await readJson(req));
    return ok(toResponseView(await regenerateResponse(membership, id, input)));
  })(request, undefined as never);
}
