import { z } from 'zod';
import { route, ok, noContent, readJson } from '@/server/http';
import { deleteClient } from '@/server/services/delete-client';
import { requireOwner } from '@/server/require-membership';
import {
  getClientOrThrow,
  toClientView,
  updateClient,
  updateClientSchema,
} from '@/server/repositories/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership) => ok(toClientView(await getClientOrThrow(membership, id))))(
    request,
    undefined as never,
  );
}

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const input = updateClientSchema.parse(await readJson(req));
    // Archiving and restoring are owner-only; ordinary edits are not. The
    // existence check runs first so a foreign id is 404, never 403.
    const existing = await getClientOrThrow(membership, id);
    if (input.archived !== undefined) requireOwner(membership);
    void existing;
    return ok(toClientView(await updateClient(membership, id, input)));
  })(request, undefined as never);
}

const deleteSchema = z.object({
  /** Must match the client's name exactly. Deletion is irreversible. */
  confirmName: z.string(),
});

export async function DELETE(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const { confirmName } = deleteSchema.parse(await readJson(req));
    await deleteClient(membership, id, confirmName);
    return noContent();
  })(request, undefined as never);
}
