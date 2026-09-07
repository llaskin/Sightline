import { failure, PRIVATE_CACHE_HEADERS, ApiError, assertSameOrigin } from '@/server/http';
import { requireMembership } from '@/server/require-membership';
import { getReportOrThrow } from '@/server/repositories/reports';
import { buildKeywordsCsv, buildPagesCsv } from '@/server/exports/csv';
import { normalizedReportSchema } from '@/domain/report-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    assertSameOrigin(request);
    const membership = await requireMembership(request.headers);
    const { id } = await context.params;

    const dataset = new URL(request.url).searchParams.get('dataset');
    if (dataset !== 'keywords' && dataset !== 'pages') {
      throw new ApiError('VALIDATION_FAILED', 'dataset must be keywords or pages');
    }

    const row = await getReportOrThrow(membership, id);
    const report = normalizedReportSchema.parse(row.snapshot);
    const csv = dataset === 'keywords' ? buildKeywordsCsv(report) : buildPagesCsv(report);

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${row.id}-${dataset}.csv"`,
        ...PRIVATE_CACHE_HEADERS,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
