import { route, created, readJson } from '@/server/http';
import { createDraft, createDraftSchema, toDraftView } from '@/server/repositories/imports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (context, request) => {
  const input = createDraftSchema.parse(await readJson(request));
  return created(toDraftView(await createDraft(context, input)));
});
