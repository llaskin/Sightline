import { route, ok, created, readJson, readPagination } from '@/server/http';
import {
  createComplaint,
  createComplaintSchema,
  listComplaints,
  toComplaintView,
} from '@/server/repositories/complaints';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (context, request) => {
  const url = new URL(request.url);
  const { limit, cursor } = readPagination(url);
  const page = await listComplaints(context, {
    limit,
    cursor,
    clientId: url.searchParams.get('clientId'),
    status: url.searchParams.get('status'),
    category: url.searchParams.get('category'),
  });
  return ok({ items: page.items.map(toComplaintView), nextCursor: page.nextCursor });
});

export const POST = route(async (context, request) => {
  const input = createComplaintSchema.parse(await readJson(request));
  return created(toComplaintView(await createComplaint(context, input)));
});
