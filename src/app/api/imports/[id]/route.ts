import { route, ok, noContent, readJson } from '@/server/http';
import {
  deleteDraft,
  getDraftOrThrow,
  patchDraft,
  patchDraftSchema,
  toDraftView,
} from '@/server/repositories/imports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => ok(toDraftView(await getDraftOrThrow(membership, id))))(
    request,
    undefined as never,
  );
}

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const input = patchDraftSchema.parse(await readJson(req));
    return ok(toDraftView(await patchDraft(membership, id, input)));
  })(request, undefined as never);
}

export async function DELETE(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => {
    await getDraftOrThrow(membership, id);
    await deleteDraft(membership, id);
    return noContent();
  })(request, undefined as never);
}
