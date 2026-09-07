import { route, ok, readPagination } from '@/server/http';
import { listReports, toReportSummary } from '@/server/repositories/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (context, request) => {
  const url = new URL(request.url);
  const { limit, cursor } = readPagination(url);
  const page = await listReports(context, {
    limit,
    cursor,
    clientId: url.searchParams.get('clientId'),
  });
  return ok({ items: page.items.map(toReportSummary), nextCursor: page.nextCursor });
});
