'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { History, RotateCcw } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, ErrorState } from '@/components/ui/primitives';
import { Button, ButtonLink } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/fields';
import {
  DIAGNOSIS_HEADLINES,
  diagnosisSchema,
  type Diagnosis,
  type EvidenceStrength,
} from '@/domain/analysis-schema';
import { formatInstant } from '@/lib/format';

/**
 * Saved analyses, listed in pages.
 *
 * Every row shows the wording the analysis itself stored. Nothing here
 * re-describes a saved result, and reanalysis adds a record rather than
 * replacing one.
 */

export type AnalysisRow = {
  id: string;
  clientId: string;
  clientName: string;
  reportId: string;
  reportLabel: string;
  complaintId: string;
  parentAnalysisId: string | null;
  diagnosis: Diagnosis;
  headline: string;
  evidenceStrength: EvidenceStrength;
  createdAt: string;
};

export type HistoryFilters = {
  clientId: string | null;
  diagnosis: Diagnosis | null;
  from: string | null;
  to: string | null;
};

/** Derived from the stored value only; it adds no judgement of its own. */
const STRENGTH_LABELS: Record<EvidenceStrength, string> = {
  limited: 'Limited',
  moderate: 'Moderate',
};

type ApiError = { code?: string; message?: string };

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: ApiError };
    return body.error ?? {};
  } catch {
    return {};
  }
}

function listQuery(filters: HistoryFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.clientId) query.set('clientId', filters.clientId);
  if (filters.diagnosis) query.set('diagnosis', filters.diagnosis);
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  return query;
}

export function HistoryTable({
  clients,
  filters,
  initialItems,
  initialCursor,
}: {
  clients: Array<{ id: string; name: string }>;
  filters: HistoryFilters;
  initialItems: AnalysisRow[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  /**
   * One key per row, so retrying the same reanalysis cannot create a second
   * record while two different rows never share an identity.
   */
  const reanalysisKeys = useRef(new Map<string, string>());

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setLoadError(null);
    try {
      const query = listQuery(filters);
      query.set('cursor', cursor);
      const response = await fetch(`/api/analyses?${query.toString()}`);
      if (!response.ok) {
        const failure = await readError(response);
        setLoadError(failure.message ?? 'The next page could not be loaded. Nothing has changed.');
        setLoading(false);
        return;
      }
      const body = (await response.json()) as {
        data: { items: AnalysisRow[]; nextCursor: string | null };
      };
      setItems((previous) => [...previous, ...body.data.items]);
      setCursor(body.data.nextCursor);
      setLoading(false);
    } catch {
      setLoadError('The next page could not be loaded. Try again.');
      setLoading(false);
    }
  }

  async function reanalyse(row: AnalysisRow) {
    setBusyRowId(row.id);
    setRowError(null);
    let key = reanalysisKeys.current.get(row.id);
    if (!key) {
      key = crypto.randomUUID();
      reanalysisKeys.current.set(row.id, key);
    }

    try {
      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({
          reportId: row.reportId,
          complaintId: row.complaintId,
          parentAnalysisId: row.id,
        }),
      });

      if (!response.ok) {
        const failure = await readError(response);
        if (failure.code === 'IDEMPOTENCY_CONFLICT') {
          // The stored key belongs to a different request now, so the next
          // attempt must introduce a new one.
          reanalysisKeys.current.delete(row.id);
        }
        setRowError({
          id: row.id,
          message:
            failure.message ??
            'The new analysis could not be created. The saved analysis is unchanged.',
        });
        setBusyRowId(null);
        return;
      }

      // A replay returns 200 with the original record; both outcomes are a
      // saved analysis, so both navigate to it.
      const body = (await response.json()) as { data: { id: string } };
      router.push(`/analyses/${body.data.id}`);
    } catch {
      setRowError({
        id: row.id,
        message: 'The new analysis could not be created. The saved analysis is unchanged.',
      });
      setBusyRowId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-0">
        <CardHeader title="Filters" />
        <form method="get" action="/history" className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SelectField
              label="Client"
              name="clientId"
              defaultValue={filters.clientId ?? ''}
              options={[
                { value: '', label: 'All clients' },
                ...clients.map((client) => ({ value: client.id, label: client.name })),
              ]}
            />
            <SelectField
              label="Diagnosis"
              name="diagnosis"
              defaultValue={filters.diagnosis ?? ''}
              options={[
                { value: '', label: 'Any diagnosis' },
                ...diagnosisSchema.options.map((value) => ({
                  value,
                  label: DIAGNOSIS_HEADLINES[value],
                })),
              ]}
            />
            <TextField
              label="Analysed from"
              name="from"
              type="date"
              defaultValue={filters.from ?? ''}
            />
            <TextField label="Analysed to" name="to" type="date" defaultValue={filters.to ?? ''} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              Apply filters
            </Button>
            <ButtonLink href="/history" variant="ghost">
              Clear
            </ButtonLink>
          </div>
        </form>
      </Card>

      <Card className="p-0">
        <CardHeader
          title="Saved analyses"
          icon={<History size={16} aria-hidden className="text-[#a99bff]" />}
        />

        {items.length === 0 ? (
          <EmptyState
            title="No saved analyses in this view"
            description="Nothing is stored under these filters. Clear them, or create an analysis from a complaint and a saved report."
            action={<ButtonLink href="/complaints">Go to complaints</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <caption className="sr-only">
                Saved analyses, newest first. Each row links to the stored result.
              </caption>
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-faint">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Analysed (UTC)
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Client
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Report
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Diagnosis
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Evidence
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {items.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-3 text-[12px] text-ink-muted">
                      {formatInstant(row.createdAt)}
                      {row.parentAnalysisId ? (
                        <span className="mt-1 block text-[11px] text-ink-faint">
                          Reanalysis of an earlier record
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-ink">{row.clientName}</td>
                    <td className="px-4 py-3 text-[12px] text-ink-muted">{row.reportLabel}</td>
                    <td className="px-4 py-3 text-[13px] text-ink">
                      {/* The stored headline, shown as saved. */}
                      {row.headline}
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{STRENGTH_LABELS[row.evidenceStrength]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-2">
                        <Link
                          href={`/analyses/${row.id}`}
                          className="inline-flex min-h-[44px] items-center text-[13px] text-[#a99bff] underline"
                        >
                          Open this analysis
                        </Link>
                        <Button
                          variant="secondary"
                          disabled={busyRowId === row.id}
                          onClick={() => reanalyse(row)}
                        >
                          <RotateCcw size={14} aria-hidden />
                          {busyRowId === row.id ? 'Creating...' : 'Reanalyse'}
                        </Button>
                        {rowError?.id === row.id ? (
                          <p role="alert" className="max-w-[260px] text-[11px] text-negative">
                            {rowError.message}
                          </p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          {cursor ? (
            <Button variant="secondary" onClick={loadMore} disabled={loading}>
              {loading ? 'Loading...' : 'Load more'}
            </Button>
          ) : (
            <p className="text-[11px] text-ink-faint">
              {items.length === 0 ? 'Nothing to show.' : 'That is every analysis in this view.'}
            </p>
          )}
          <p className="text-[11px] text-ink-faint">
            Reanalyse creates a new analysis from the same report and complaint and links it back to
            the row it came from. The earlier analysis stays exactly as it was saved.
          </p>
        </div>

        {loadError ? (
          <div className="px-4 pb-4">
            <ErrorState title="Could not load more" description={loadError} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
