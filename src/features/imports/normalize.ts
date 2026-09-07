import {
  normalizedReportSchema,
  type DatasetName,
  type NormalizedReport,
} from '@/domain/report-schema';
import type { RowError } from './csv';

/**
 * The single normalisation path. CSV uploads and manual entry both arrive here,
 * so the two can never produce different canonical values for the same input.
 */

export type DraftDatasets = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in DatasetName]?: any[] | null;
};

export type NormalizeResult =
  | { ok: true; report: NormalizedReport; errors: [] }
  | { ok: false; report: null; errors: RowError[] };

/**
 * Validates a draft into an immutable report candidate. Field errors carry the
 * dotted path so the wizard can point at the offending input.
 */
export function normalizeDraft(input: unknown): NormalizeResult {
  const parsed = normalizedReportSchema.safeParse(input);
  if (parsed.success) return { ok: true, report: parsed.data, errors: [] };

  const errors: RowError[] = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    // A numeric path segment identifies the offending row for the user.
    const rowSegment = issue.path.find((segment) => typeof segment === 'number');
    return {
      code: 'SCHEMA',
      row: typeof rowSegment === 'number' ? rowSegment + 1 : null,
      field: path || null,
      value: null,
      message: issue.message,
    };
  });

  return { ok: false, report: null, errors };
}

/** Datasets that are optional; their absence is a named gap, never a zero. */
export const OPTIONAL_DATASETS: DatasetName[] = [
  'keywords',
  'forms',
  'landingPages',
  'trafficTrend',
  'outcomes',
];
