import { route, ok, created, readJson } from '@/server/http';
import { requireOwner } from '@/server/require-membership';
import {
  createTemplate,
  createTemplateSchema,
  listTemplates,
  toTemplateView,
} from '@/server/repositories/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (context) =>
  ok({ items: (await listTemplates(context)).map(toTemplateView) }),
);

export const POST = route(async (context, request) => {
  requireOwner(context);
  const input = createTemplateSchema.parse(await readJson(request));
  return created(toTemplateView(await createTemplate(context, input)));
});
