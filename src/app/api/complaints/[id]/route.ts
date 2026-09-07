import { route, ok, readJson } from '@/server/http';
import {
  getComplaintOrThrow,
  toComplaintView,
  updateComplaint,
  updateComplaintSchema,
} from '@/server/repositories/complaints';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => ok(toComplaintView(await getComplaintOrThrow(membership, id))))(
    request,
    undefined as never,
  );
}

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const input = updateComplaintSchema.parse(await readJson(req));
    await getComplaintOrThrow(membership, id);
    return ok(toComplaintView(await updateComplaint(membership, id, input)));
  })(request, undefined as never);
}
