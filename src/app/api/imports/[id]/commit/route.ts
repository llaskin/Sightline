import { z } from 'zod';
import { route, created, replayed as replayedResponse, readJson } from '@/server/http';
import { requireIdempotencyKey } from '@/server/idempotency';
import { commitImport } from '@/server/services/commit-import';
import { toReportDetail } from '@/server/repositories/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  expectedRevision: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  supersedesReportId: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const requestKey = requireIdempotencyKey(req);
    const input = schema.parse(await readJson(req));
    const { report, replayed } = await commitImport(
      membership,
      { draftId: id, ...input },
      requestKey,
    );
    const body = toReportDetail(report);
    // A replay returns 200 with replayed=true rather than a second 201.
    return replayed ? replayedResponse(body) : created(body);
  })(request, undefined as never);
}
