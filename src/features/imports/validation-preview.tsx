'use client';

import { Card, CardHeader, Badge, NotProvided } from '@/components/ui/primitives';

/**
 * The validation preview.
 *
 * It reports what the server said, in the server's own words. Errors are shown
 * with the row, the field, the value that was rejected and the reason, so a
 * correction can be made without guessing. Absent optional datasets are listed
 * as named gaps rather than being quietly treated as zero.
 */

export type RowErrorView = {
  code: string;
  row: number | null;
  field: string | null;
  value: string | null;
  message: string;
};

export type DatasetKey =
  | 'organic'
  | 'keywords'
  | 'forms'
  | 'landingPages'
  | 'trafficTrend'
  | 'outcomes';

export const DATASET_LABELS: Record<DatasetKey, string> = {
  organic: 'Organic summary',
  keywords: 'Keywords',
  forms: 'Forms',
  landingPages: 'Landing pages',
  trafficTrend: 'Traffic trend',
  outcomes: 'Business outcomes',
};

const GAP_MEANING: Record<DatasetKey, string> = {
  organic: 'Without it there is no comparison at all; this dataset is required.',
  keywords: 'Ranking movement cannot be shown, and no rank rule can activate.',
  forms: 'Form attempts and failures are unknown, so a post-click failure cannot be established.',
  landingPages: 'Landing-page detail is unavailable, so traffic cannot be broken down by page.',
  trafficTrend: 'The dashboard states that trend data was not provided; it draws no line.',
  outcomes: 'Received leads, qualified leads and revenue stay unknown rather than assumed zero.',
};

/** Reads a dotted path such as `datasets.organic.0.sessions` out of the draft. */
function readPath(payload: unknown, path: string | null): unknown {
  if (!path) return undefined;
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function RejectedValue({ error, payload }: { error: RowErrorView; payload: unknown }) {
  // CSV parse errors carry the raw cell; schema errors do not, so the offending
  // value is looked up in the draft rather than left blank.
  const raw = error.value ?? readPath(payload, error.field);
  if (raw === undefined || raw === null || raw === '') return <NotProvided />;
  const text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  return (
    <span className="break-words text-ink">
      {text.length > 120 ? `${text.slice(0, 120)}...` : text}
    </span>
  );
}

export function ValidationPreview({
  state,
  errors,
  totalErrorCount,
  reportedLimit,
  payload,
}: {
  state: 'unvalidated' | 'passed' | 'failed';
  errors: RowErrorView[];
  totalErrorCount: number;
  reportedLimit: number;
  payload: {
    datasets?: Partial<Record<DatasetKey, unknown[] | null>>;
    selectedForm?: { formId: string; scope: string } | null;
    trendGranularity?: string | null;
  };
}) {
  const datasets = payload.datasets ?? {};
  const keys = Object.keys(DATASET_LABELS) as DatasetKey[];
  const present = keys.filter((key) => Array.isArray(datasets[key]) && datasets[key]!.length > 0);
  const gaps = keys.filter((key) => !present.includes(key));

  const notes: string[] = [];
  if (present.includes('forms') && !payload.selectedForm) {
    notes.push(
      'Form rows are present but no single form and scope has been selected, so no form rate can be used.',
    );
  }
  if (present.includes('trafficTrend') && !payload.trendGranularity) {
    notes.push('Trend rows are present but the granularity has not been stated.');
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Validation"
          action={
            state === 'passed' ? (
              <Badge tone="positive">Passed</Badge>
            ) : state === 'failed' ? (
              <Badge tone="negative">Failed</Badge>
            ) : (
              <Badge>Not run yet</Badge>
            )
          }
        />
        <div className="px-4 pb-4">
          {state === 'unvalidated' ? (
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Run validation to see exactly what the server accepts. Any edit made afterwards resets
              this draft and validation must be run again before it can be committed.
            </p>
          ) : state === 'passed' ? (
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Every value passed. The content the server validated is the content a commit will
              store, so do not edit anything before committing.
            </p>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {totalErrorCount === 1
                  ? '1 value was rejected.'
                  : `${totalErrorCount} values were rejected.`}
                {totalErrorCount > reportedLimit
                  ? ` The first ${reportedLimit} are listed below; correct these and validate again to see the rest.`
                  : ''}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-[12px]">
                  <caption className="sr-only">
                    Validation errors, with the row, field, rejected value and reason for each
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-ink-faint">
                      <th scope="col" className="py-2 pr-3 font-medium">Row</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Field</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Rejected value</th>
                      <th scope="col" className="py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((error, index) => (
                      <tr
                        key={`${error.code}-${error.field}-${error.row}-${index}`}
                        className="border-b border-line/60 align-top last:border-0"
                      >
                        <td className="py-2 pr-3 text-ink-muted">
                          {error.row === null ? <NotProvided>Whole file</NotProvided> : error.row}
                        </td>
                        <td className="py-2 pr-3 text-ink-muted">
                          {error.field ?? <NotProvided>Whole record</NotProvided>}
                        </td>
                        <td className="py-2 pr-3">
                          <RejectedValue error={error} payload={payload} />
                        </td>
                        <td className="py-2 leading-relaxed text-ink">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Datasets in this draft" />
        <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Present</h3>
            {present.length === 0 ? (
              <p className="text-[12px] text-ink-muted">Nothing has been supplied yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[12px]">
                {present.map((key) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span className="text-ink">{DATASET_LABELS[key]}</span>
                    <span className="text-ink-faint">
                      {datasets[key]!.length} {datasets[key]!.length === 1 ? 'row' : 'rows'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Gaps</h3>
            {gaps.length === 0 ? (
              <p className="text-[12px] text-ink-muted">Every dataset has been supplied.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-[12px]">
                {gaps.map((key) => (
                  <li key={key}>
                    <span className="text-ink">{DATASET_LABELS[key]}</span>
                    <span className="block leading-relaxed text-ink-faint">{GAP_MEANING[key]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {notes.length > 0 ? (
          <ul className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-caution">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
