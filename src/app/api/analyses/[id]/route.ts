import { route, ok } from '@/server/http';
import { getAnalysisDetailOrThrow, toAnalysisDetail } from '@/server/repositories/analyses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  // A read returns the stored snapshot. The rules are never re-run here.
  return route(async (membership) =>
    ok(toAnalysisDetail(await getAnalysisDetailOrThrow(membership, id))),
  )(request, undefined as never);
}
