import { z } from 'zod';
import { route, ok, created, replayed as replayedResponse, readJson, readPagination } from '@/server/http';
import { requireIdempotencyKey } from '@/server/idempotency';
import { createAnalysis } from '@/server/services/create-analysis';
import { listAnalyses, toAnalysisSummary, getAnalysisDetailOrThrow, toAnalysisDetail } from '@/server/repositories/analyses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  reportId: z.string(),
  complaintId: z.string(),
  parentAnalysisId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
});

export const GET = route(async (context, request) => {
  const url = new URL(request.url);
  const { limit, cursor } = readPagination(url);
  const page = await listAnalyses(context, {
    limit,
    cursor,
    clientId: url.searchParams.get('clientId'),
    diagnosis: url.searchParams.get('diagnosis'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
  return ok({ items: page.items.map(toAnalysisSummary), nextCursor: page.nextCursor });
});

export const POST = route(async (context, request) => {
  const requestKey = requireIdempotencyKey(request);
  const input = schema.parse(await readJson(request));
  const result = await createAnalysis(context, input, requestKey);
  const detail = toAnalysisDetail(await getAnalysisDetailOrThrow(context, result.analysis.id));
  return result.replayed ? replayedResponse(detail) : created(detail);
});
