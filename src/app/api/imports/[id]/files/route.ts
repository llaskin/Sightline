import { route, ok, ApiError } from '@/server/http';
import { getDraftOrThrow, patchDraft, toDraftView, type DraftPayload } from '@/server/repositories/imports';
import { parseDatasetCsv, DEFAULT_LIMITS } from '@/features/imports/csv';
import { TEMPLATE_DEFINITIONS } from '@/features/imports/templates';
import type { DatasetName } from '@/domain/report-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** A whole request may carry one file plus small fields. */
const MAX_REQUEST_BYTES = DEFAULT_LIMITS.maxBytes + 64 * 1024;

/**
 * Reads the body under a hard byte cap.
 *
 * A `Content-Length` check alone is not enough, because a chunked request may
 * omit it entirely. The stream is therefore counted as it arrives and aborted
 * the moment it exceeds the cap, so an oversized upload is never fully
 * buffered in memory.
 */
async function readBoundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_REQUEST_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'That upload is larger than the 5 MiB limit');
  }
  if (!request.body) throw new ApiError('VALIDATION_FAILED', 'No file was uploaded');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new ApiError('PAYLOAD_TOO_LARGE', 'That upload is larger than the 5 MiB limit');
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Keeps only a safe file name; the original path is never trusted or stored. */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'upload.csv';
}

const DATASET_NAMES = new Set(TEMPLATE_DEFINITIONS.map((definition) => definition.dataset));

export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return route(async (membership, req) => {
    const bytes = await readBoundedBody(req);

    // Re-present the bounded buffer for multipart parsing. A Blob is used
    // because a Uint8Array view is not a valid BodyInit.
    const form = await new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
      body: new Blob([bytes]),
    }).formData();

    const dataset = String(form.get('dataset') ?? '') as DatasetName;
    if (!DATASET_NAMES.has(dataset)) {
      throw new ApiError('VALIDATION_FAILED', 'Choose which dataset this file contains', {
        dataset: [`Must be one of: ${[...DATASET_NAMES].join(', ')}`],
      });
    }
    const expectedRevision = Number(form.get('expectedRevision'));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new ApiError('VALIDATION_FAILED', 'A valid expectedRevision is required');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ApiError('VALIDATION_FAILED', 'No file was uploaded', { file: ['Attach a CSV file'] });
    }

    const draft = await getDraftOrThrow(membership, id);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseDatasetCsv(dataset, fileBytes);

    if (!parsed.ok) {
      // A failed parse never changes the draft, so a bad file cannot leave it
      // half-populated.
      return ok({
        ...toDraftView(draft),
        upload: {
          dataset,
          ok: false,
          errors: parsed.errors,
          totalErrorCount: parsed.totalErrorCount,
          rowCount: 0,
        },
      });
    }

    const payload = draft.payload as DraftPayload;
    const updated = await patchDraft(membership, id, {
      expectedRevision,
      datasets: { ...(payload.datasets ?? {}), [dataset]: parsed.rows },
      // Provenance only. The uploaded bytes themselves are discarded here.
      files: {
        ...(payload.files ?? {}),
        [dataset]: {
          name: sanitizeFileName(file.name),
          contentHash: parsed.contentHash,
          byteCount: parsed.byteCount,
          rowCount: parsed.rowCount,
        },
      },
    });

    return ok({
      ...toDraftView(updated),
      upload: { dataset, ok: true, errors: [], totalErrorCount: 0, rowCount: parsed.rowCount },
    });
  })(request, undefined as never);
}
