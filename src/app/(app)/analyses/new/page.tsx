'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Play } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, ErrorState } from '@/components/ui/primitives';
import { Button, ButtonLink } from '@/components/ui/button';
import { SelectField } from '@/components/ui/fields';
import {
  ComplaintForm,
  COMPLAINT_SCOPE_LABELS,
  COMPLAINT_STATUS_LABELS,
  type ComplaintScope,
  type ComplaintSummary,
} from '@/features/complaints/complaint-form';
import { COMPLAINT_CATEGORY_LABELS } from '@/domain/complaint-schema';
import { formatDateRange, formatInstant } from '@/lib/format';

/**
 * Starting an analysis.
 *
 * This screen is a client component because the whole flow is interactive:
 * choosing a client, choosing or recording a complaint, choosing a report, and
 * one idempotent submission. The surrounding layout has already resolved the
 * session on the server, so nothing here is the only thing standing between a
 * signed-out visitor and the data.
 */

type ClientOption = { id: string; name: string; archivedAt: string | null };

type ClientData = {
  clientId: string;
  complaints: ComplaintSummary[];
  reports: ReportSummary[];
};

/** Mirrors `toReportSummary` in the reports repository. */
type ReportSummary = {
  id: string;
  clientId: string;
  reportLabel: string;
  currentStart: string;
  currentEnd: string;
  baselineStart: string;
  baselineEnd: string;
  createdAt: string;
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function readList<T>(path: string): Promise<T[]> {
  const response = await fetch(path);
  if (!response.ok) {
    const failure = await readError(response);
    throw new Error(failure.message ?? 'That list could not be loaded.');
  }
  const body = (await response.json()) as { data: { items: T[] } };
  return body.data.items;
}

export default function NewAnalysisPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight text-ink">New analysis</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Pair one saved report with one recorded complaint
        </p>
      </header>
      <Suspense
        fallback={
          <Card>
            <EmptyState title="Loading" description="Fetching your clients." />
          </Card>
        }
      >
        <NewAnalysisFlow />
      </Suspense>
    </div>
  );
}

function NewAnalysisFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get('clientId') ?? '';
  const complaintId = searchParams.get('complaintId') ?? '';

  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [clientsError, setClientsError] = useState<string | null>(null);
  /** Held with the client it was fetched for, so it can never be shown under another. */
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [dataError, setDataError] = useState<{ clientId: string; message: string } | null>(null);
  /** Null until the user picks one; the default is derived rather than stored. */
  const [chosenReportId, setChosenReportId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Bumped by a retry, which is what re-runs the read. */
  const [clientsAttempt, setClientsAttempt] = useState(0);
  const [dataAttempt, setDataAttempt] = useState(0);

  /**
   * The server identifies a request by its key and its payload, so the key is
   * held against the payload it belongs to: a retry of the same action reuses
   * it, and changing the report or complaint earns a new one.
   */
  const idempotency = useRef<{ payload: string; key: string } | null>(null);

  function keyFor(payload: string): string {
    if (idempotency.current?.payload !== payload) {
      idempotency.current = { payload, key: crypto.randomUUID() };
    }
    return idempotency.current.key;
  }

  // Each read settles in a callback, and a cancelled effect drops its result,
  // so a slower earlier request cannot overwrite a newer one.
  useEffect(() => {
    let cancelled = false;
    readList<ClientOption>('/api/clients?limit=100')
      .then((items) => {
        if (cancelled) return;
        setClients(items);
        setClientsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setClientsError(messageOf(error, 'Your clients could not be loaded.'));
      });
    return () => {
      cancelled = true;
    };
  }, [clientsAttempt]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    Promise.all([
      readList<ComplaintSummary>(`/api/complaints?clientId=${encodeURIComponent(clientId)}&limit=50`),
      readList<ReportSummary>(`/api/reports?clientId=${encodeURIComponent(clientId)}&limit=50`),
    ])
      .then(([complaintList, reportList]) => {
        if (cancelled) return;
        setClientData({ clientId, complaints: complaintList, reports: reportList });
        setDataError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDataError({
          clientId,
          message: messageOf(error, 'This client could not be loaded.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, dataAttempt]);

  // Everything below is derived from the loaded data, so switching client shows
  // that client's records rather than the previous one's.
  const loaded = clientData?.clientId === clientId ? clientData : null;
  const complaints = loaded?.complaints ?? null;
  const reports = loaded?.reports ?? null;
  const loadError = dataError?.clientId === clientId ? dataError.message : null;

  const selectedComplaint = complaints?.find((complaint) => complaint.id === complaintId) ?? null;

  // The report whose current period matches the complaint is the only pairing
  // that can assess the outcome, so it is the default. An explicit choice wins.
  const matchingReport = selectedComplaint
    ? reports?.find(
        (report) =>
          report.currentStart === selectedComplaint.periodStart &&
          report.currentEnd === selectedComplaint.periodEnd,
      )
    : undefined;
  const chosenIsAvailable = reports?.some((report) => report.id === chosenReportId) ?? false;
  const reportId = chosenIsAvailable
    ? (chosenReportId as string)
    : (matchingReport?.id ?? reports?.[0]?.id ?? '');
  const selectedReport = reports?.find((report) => report.id === reportId) ?? null;

  function goTo(nextClientId: string, nextComplaintId: string | null) {
    const query = new URLSearchParams();
    if (nextClientId) query.set('clientId', nextClientId);
    if (nextComplaintId) query.set('complaintId', nextComplaintId);
    router.replace(`/analyses/new?${query.toString()}`, { scroll: false });
  }

  async function submit() {
    if (!selectedComplaint || !selectedReport) return;
    setSubmitting(true);
    setSubmitError(null);

    const payload = { reportId: selectedReport.id, complaintId: selectedComplaint.id };
    const key = keyFor(JSON.stringify(payload));

    try {
      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const failure = await readError(response);
        if (failure.code === 'IDEMPOTENCY_CONFLICT') {
          // That key now belongs to a different request, so the next attempt
          // must carry a new one.
          idempotency.current = null;
        }
        setSubmitError(
          failure.message ?? 'The analysis could not be created. Nothing was saved.',
        );
        setSubmitting(false);
        return;
      }

      // 201 for a new analysis and 200 for a replayed one both mean a saved
      // analysis exists, so both go to it.
      const body = (await response.json()) as { data: { id: string } };
      router.push(`/analyses/${body.data.id}`);
    } catch {
      setSubmitError('The analysis could not be created, so nothing was saved. Try again.');
      setSubmitting(false);
    }
  }

  if (clientsError && !clients) {
    return (
      <Card>
        <div className="p-4">
          <ErrorState title="Could not load this page" description={clientsError} />
          <div className="mt-3">
            <Button variant="secondary" onClick={() => setClientsAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!clients) {
    return (
      <Card>
        <EmptyState title="Loading" description="Fetching your clients." />
      </Card>
    );
  }

  const activeClients = clients.filter((client) => client.archivedAt === null);

  if (activeClients.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Add a client first"
          description="An analysis belongs to one client, one of their reports and one of their complaints. There is no active client to start from yet."
          action={<ButtonLink href="/clients?new=1">Add a client</ButtonLink>}
        />
      </Card>
    );
  }

  const returnPath = `/analyses/new?clientId=${clientId}${
    complaintId ? `&complaintId=${complaintId}` : ''
  }`;
  const importHref = `/reports/new?clientId=${clientId}&returnTo=${encodeURIComponent(returnPath)}`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-0">
        <CardHeader title="1. Client" />
        <div className="px-4 pb-4">
          <SelectField
            label="Client"
            hint="The report and the complaint must belong to the same client."
            value={clientId}
            onChange={(event) => goTo(event.target.value, null)}
            options={[
              { value: '', label: 'Choose a client', disabled: true },
              ...activeClients.map((client) => ({ value: client.id, label: client.name })),
            ]}
          />
        </div>
      </Card>

      {!clientId ? (
        <Card>
          <EmptyState
            title="Choose a client to continue"
            description="Their recorded complaints and saved reports are listed once a client is chosen."
          />
        </Card>
      ) : (
        <>
          <Card className="p-0">
            <CardHeader title="2. Complaint" />
            <div className="flex flex-col gap-4 px-4 pb-4">
              {loadError ? (
                <div>
                  <ErrorState title="Could not load" description={loadError} />
                  <div className="mt-2">
                    <Button variant="secondary" onClick={() => setDataAttempt((n) => n + 1)}>
                      Try again
                    </Button>
                  </div>
                </div>
              ) : null}

              {!complaints ? (
                <p className="text-[13px] text-ink-muted">Loading recorded complaints...</p>
              ) : complaints.length === 0 ? (
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  Nothing has been recorded for this client yet. Add the complaint below, in the
                  wording it arrived in.
                </p>
              ) : (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-[12px] font-medium text-ink-muted">
                    Choose a recorded complaint
                  </legend>
                  {complaints.map((complaint) => (
                    <label
                      key={complaint.id}
                      className={`flex min-h-[44px] cursor-pointer gap-3 rounded-[10px] border p-3 ${
                        complaint.id === complaintId
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-canvas'
                      }`}
                    >
                      <input
                        type="radio"
                        name="complaint"
                        className="mt-1"
                        value={complaint.id}
                        checked={complaint.id === complaintId}
                        onChange={() => goTo(clientId, complaint.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                          {complaint.originalText}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge>{COMPLAINT_CATEGORY_LABELS[complaint.category]}</Badge>
                          <Badge>{COMPLAINT_SCOPE_LABELS[complaint.scope as ComplaintScope]}</Badge>
                          <Badge>
                            {formatDateRange(complaint.periodStart, complaint.periodEnd)}
                          </Badge>
                          <Badge>{COMPLAINT_STATUS_LABELS[complaint.status]}</Badge>
                        </span>
                        <span className="mt-1 block text-[11px] text-ink-faint">
                          Received {formatInstant(complaint.receivedAt)} UTC
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              <details className="rounded-[10px] border border-line bg-canvas p-3">
                <summary className="cursor-pointer text-[13px] text-ink">
                  Record a new complaint instead
                </summary>
                <div className="mt-3">
                  <ComplaintForm
                    // Remounted per client so the form always opens on the one
                    // chosen above rather than the one chosen before it.
                    key={clientId}
                    clients={activeClients.map((client) => ({
                      id: client.id,
                      name: client.name,
                    }))}
                    defaultClientId={clientId}
                    onCreated={(complaint) => {
                      setClientData((previous) =>
                        previous && previous.clientId === complaint.clientId
                          ? { ...previous, complaints: [complaint, ...previous.complaints] }
                          : previous,
                      );
                      // The new complaint goes into the address, so a refresh
                      // and the import return link both keep hold of it.
                      goTo(complaint.clientId, complaint.id);
                    }}
                  />
                </div>
              </details>
            </div>
          </Card>

          <Card className="p-0">
            <CardHeader
              title="3. Report"
              icon={<CalendarDays size={16} aria-hidden className="text-ink-faint" />}
            />
            <div className="flex flex-col gap-3 px-4 pb-4">
              {!reports ? (
                <p className="text-[13px] text-ink-muted">Loading saved reports...</p>
              ) : reports.length === 0 ? (
                <>
                  <p className="text-[13px] leading-relaxed text-ink-muted">
                    This client has no saved report, and an analysis needs one. Import a report
                    covering two comparable periods, then come back here.
                  </p>
                  <div>
                    <ButtonLink href={importHref} variant="primary">
                      Import a report
                    </ButtonLink>
                  </div>
                  {complaintId ? (
                    <p className="text-[11px] leading-relaxed text-ink-faint">
                      The complaint you chose is already saved, and the link above carries its
                      identifier as the address to return to. If the import does not bring you back
                      here, reopen this screen from{' '}
                      <Link href="/complaints" className="underline">
                        Complaints
                      </Link>{' '}
                      and the same complaint is still there.
                    </p>
                  ) : null}
                </>
              ) : (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-[12px] font-medium text-ink-muted">
                    Choose a saved report for this client
                  </legend>
                  {reports.map((report) => {
                    const matches =
                      selectedComplaint !== null &&
                      report.currentStart === selectedComplaint.periodStart &&
                      report.currentEnd === selectedComplaint.periodEnd;
                    return (
                      <label
                        key={report.id}
                        className={`flex min-h-[44px] cursor-pointer gap-3 rounded-[10px] border p-3 ${
                          report.id === reportId ? 'border-accent bg-accent-soft' : 'border-line bg-canvas'
                        }`}
                      >
                        <input
                          type="radio"
                          name="report"
                          className="mt-1"
                          value={report.id}
                          checked={report.id === reportId}
                          onChange={() => setChosenReportId(report.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-ink">
                            {report.reportLabel}
                          </span>
                          <span className="mt-1 block text-[12px] text-ink-muted">
                            Current period {formatDateRange(report.currentStart, report.currentEnd)}
                          </span>
                          <span className="block text-[12px] text-ink-muted">
                            Baseline period{' '}
                            {formatDateRange(report.baselineStart, report.baselineEnd)}
                          </span>
                          {selectedComplaint ? (
                            <span className="mt-2 inline-block">
                              <Badge tone={matches ? 'positive' : 'caution'}>
                                {matches
                                  ? 'Matches the complaint period'
                                  : 'Different from the complaint period'}
                              </Badge>
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              )}

              {selectedComplaint && selectedReport &&
              (selectedReport.currentStart !== selectedComplaint.periodStart ||
                selectedReport.currentEnd !== selectedComplaint.periodEnd) ? (
                <div
                  role="alert"
                  className="rounded-[10px] border border-caution/50 bg-caution/5 p-3"
                >
                  <p className="text-[13px] font-semibold text-caution">
                    The complaint period and the report period are not the same
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                    The complaint covers{' '}
                    {formatDateRange(selectedComplaint.periodStart, selectedComplaint.periodEnd)} and
                    this report covers{' '}
                    {formatDateRange(selectedReport.currentStart, selectedReport.currentEnd)}. You
                    can still run this analysis. It will record that the claimed outcome cannot be
                    checked against this evidence, and it will say why, instead of comparing two
                    different stretches of time as though they were one.
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                    To assess the outcome itself, pick a report whose current period matches the
                    complaint, or record the complaint against the period the report covers.
                  </p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-0">
            <CardHeader title="4. Start the analysis" />
            <div className="flex flex-col gap-3 px-4 pb-4">
              {submitError ? <ErrorState title="Not created" description={submitError} /> : null}

              <p className="text-[12px] leading-relaxed text-ink-muted">
                The result is worked out from the two saved snapshots and stored as it stands. A
                result of more comparable evidence being needed is a saved analysis like any other:
                it names what is missing. It is neither a failure nor a statement that nothing is
                wrong.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={submitting || !selectedComplaint || !selectedReport}
                >
                  <Play size={15} aria-hidden />
                  {submitting ? 'Creating the analysis...' : 'Create analysis'}
                </Button>
                <span aria-live="polite" className="text-[11px] text-ink-muted">
                  {submitting
                    ? 'Working through the saved report and complaint. Stay on this page.'
                    : !selectedComplaint
                      ? 'Choose or record a complaint to continue.'
                      : !selectedReport
                        ? 'Choose a saved report to continue.'
                        : ''}
                </span>
              </div>

              <p className="text-[11px] text-ink-faint">
                Looking for an earlier result?{' '}
                <Link href="/history" className="underline">
                  Analysis history
                </Link>{' '}
                lists every saved analysis.
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
