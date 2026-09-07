import { route, ok } from '@/server/http';
import { getReportOrThrow, toReportDetail } from '@/server/repositories/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => ok(toReportDetail(await getReportOrThrow(membership, id))))(
    request,
    undefined as never,
  );
}
