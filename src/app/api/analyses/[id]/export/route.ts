import { failure, PRIVATE_CACHE_HEADERS, ApiError } from '@/server/http';
import { assertSameOrigin } from '@/server/http';
import { requireMembership } from '@/server/require-membership';
import { getAnalysisDetailOrThrow } from '@/server/repositories/analyses';
import { buildAnalysisMarkdown } from '@/server/exports/markdown';
import { complaintInputSchema } from '@/domain/complaint-schema';
import { normalizedReportSchema } from '@/domain/report-schema';
import { analysisResultSchema } from '@/domain/analysis-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    assertSameOrigin(request);
    const membership = await requireMembership(request.headers);
    const { id } = await context.params;

    const format = new URL(request.url).searchParams.get('format') ?? 'md';
    if (format !== 'md') {
      throw new ApiError('VALIDATION_FAILED', 'Only format=md is supported');
    }

    // The same membership and relationship checks as a screen read.
    const detail = await getAnalysisDetailOrThrow(membership, id);

    const markdown = buildAnalysisMarkdown({
      analysisId: detail.analysis.id,
      reportId: detail.report.id,
      clientName: detail.client.name,
      reportLabel: detail.report.reportLabel,
      report: normalizedReportSchema.parse(detail.report.snapshot),
      complaint: complaintInputSchema.parse(detail.analysis.complaintSnapshot),
      result: analysisResultSchema.parse(detail.analysis.result),
      response: detail.revision
        ? {
            revision: detail.revision.revision,
            generatedText: detail.revision.generatedText,
            editedText: detail.revision.editedText,
          }
        : null,
      createdAt: detail.analysis.createdAt.toISOString(),
    });

    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        // A fixed name plus the id: never derived from user-supplied text.
        'Content-Disposition': `attachment; filename="analysis-${detail.analysis.id}.md"`,
        ...PRIVATE_CACHE_HEADERS,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
