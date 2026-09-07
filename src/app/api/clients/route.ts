import { route, ok, created, readJson, readPagination } from '@/server/http';
import {
  createClient,
  createClientSchema,
  listClients,
  toClientView,
} from '@/server/repositories/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (context, request) => {
  const url = new URL(request.url);
  const { limit, cursor } = readPagination(url);
  const page = await listClients(context, {
    limit,
    cursor,
    includeArchived: url.searchParams.get('includeArchived') === 'true',
  });
  return ok({ items: page.items.map(toClientView), nextCursor: page.nextCursor });
});

export const POST = route(async (context, request) => {
  const input = createClientSchema.parse(await readJson(request));
  return created(toClientView(await createClient(context, input)));
});
