import { route, ok, readJson } from '@/server/http';
import { requireOwner } from '@/server/require-membership';
import { readSettings, updateSettings, updateSettingsSchema } from '@/server/repositories/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (context) => ok(await readSettings(context)));

export const PATCH = route(async (context, request) => {
  requireOwner(context);
  const input = updateSettingsSchema.parse(await readJson(request));
  return ok(await updateSettings(context, input));
});
