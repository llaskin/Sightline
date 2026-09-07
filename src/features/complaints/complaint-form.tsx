'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import { Card, CardHeader, ErrorState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ErrorSummary, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import {
  COMPLAINT_CATEGORY_LABELS,
  MAX_COMPLAINT_TEXT,
  complaintCategorySchema,
  type ComplaintCategory,
  type ComplaintStatus,
} from '@/domain/complaint-schema';

/**
 * Complaint capture and the status controls that go with it.
 *
 * Two rules shape this file. The client's wording is stored verbatim, so it is
 * captured in one plain textarea and never rewritten on the way to the server.
 * And a rejected save keeps every typed value on screen, because a validation
 * error must not cost the user the complaint they were transcribing.
 */

export type ComplaintScope = 'organic_search' | 'all_channels';

/** Mirrors `toComplaintView` in the complaints repository. */
export type ComplaintSummary = {
  id: string;
  clientId: string;
  originalText: string;
  category: ComplaintCategory;
  scope: ComplaintScope;
  periodStart: string;
  periodEnd: string;
  receivedAt: string;
  status: ComplaintStatus;
  revision: number;
  createdAt: string;
};

export const COMPLAINT_SCOPE_LABELS: Record<ComplaintScope, string> = {
  organic_search: 'Organic search',
  all_channels: 'All channels',
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'Open',
  analyzed: 'Analysed',
  resolved: 'Resolved',
};

const CATEGORY_OPTIONS = complaintCategorySchema.options.map((value) => ({
  value,
  label: COMPLAINT_CATEGORY_LABELS[value],
}));

const SCOPE_OPTIONS = (Object.keys(COMPLAINT_SCOPE_LABELS) as ComplaintScope[]).map((value) => ({
  value,
  label: COMPLAINT_SCOPE_LABELS[value],
}));

/** Server field names carry no meaning on screen, so they are relabelled. */
const FIELD_LABELS: Record<string, string> = {
  clientId: 'Client',
  originalText: 'What the client said',
  category: 'Category',
  scope: 'Scope',
  periodStart: 'Complaint period start',
  periodEnd: 'Complaint period end',
  receivedAt: 'Received',
};

type ApiError = { code?: string; message?: string; fields?: Record<string, string[]> };

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: ApiError };
    return body.error ?? {};
  } catch {
    return {};
  }
}

/** `datetime-local` wants a local wall-clock value, not a UTC instant. */
function localDateTimeValue(instant: Date): string {
  const offsetMs = instant.getTimezoneOffset() * 60_000;
  return new Date(instant.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function ComplaintForm({
  clients,
  defaultClientId = null,
  onCreated,
}: {
  clients: Array<{ id: string; name: string }>;
  defaultClientId?: string | null;
  /** When absent the surrounding server-rendered list is refreshed instead. */
  onCreated?: (complaint: ComplaintSummary) => void;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? '');
  const [category, setCategory] = useState<ComplaintCategory>('no_leads');
  const [scope, setScope] = useState<ComplaintScope>('organic_search');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          originalText,
          category,
          scope,
          periodStart,
          periodEnd,
          // Stored as an unambiguous instant; the picker collects local time.
          receivedAt: receivedAt ? new Date(receivedAt).toISOString() : '',
        }),
      });

      if (!response.ok) {
        const failure = await readError(response);
        // Kept under the server's own field names so each control can name its
        // own error; the summary relabels them for reading.
        if (failure.fields) setFieldErrors(failure.fields);
        setError(failure.message ?? 'The complaint could not be saved. Nothing was recorded.');
        setPending(false);
        return;
      }

      const body = (await response.json()) as { data: ComplaintSummary };
      // Only a saved complaint clears the form, so a failure never costs the
      // user the wording they transcribed.
      setOriginalText('');
      setPending(false);
      if (onCreated) {
        onCreated(body.data);
        return;
      }
      router.refresh();
    } catch {
      setError('The complaint could not be saved, so nothing was recorded. Your text is still here.');
      setPending(false);
    }
  }

  const remaining = MAX_COMPLAINT_TEXT - originalText.length;

  return (
    <Card className="p-0">
      <CardHeader
        title="New complaint"
        icon={<MessageSquarePlus size={16} aria-hidden className="text-[#a99bff]" />}
      />
      <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4">
        {Object.keys(fieldErrors).length > 0 ? (
          <ErrorSummary
            errors={Object.fromEntries(
              Object.entries(fieldErrors).map(([field, messages]) => [
                FIELD_LABELS[field] ?? field,
                messages,
              ]),
            )}
          />
        ) : null}
        {error && Object.keys(fieldErrors).length === 0 ? (
          <ErrorState title="Not saved" description={error} />
        ) : null}

        <SelectField
          label="Client"
          error={fieldErrors.clientId?.join('; ')}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
          required
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Category"
            error={fieldErrors.category?.join('; ')}
            hint="The structured category is used by the rules. It never replaces the wording below."
            value={category}
            onChange={(event) => setCategory(event.target.value as ComplaintCategory)}
            options={CATEGORY_OPTIONS}
            required
          />
          <SelectField
            label="Scope"
            error={fieldErrors.scope?.join('; ')}
            hint="Organic search only, or every channel the client counts."
            value={scope}
            onChange={(event) => setScope(event.target.value as ComplaintScope)}
            options={SCOPE_OPTIONS}
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Complaint period start"
            error={fieldErrors.periodStart?.join('; ')}
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
            required
          />
          <TextField
            label="Complaint period end"
            error={fieldErrors.periodEnd?.join('; ')}
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
            required
          />
        </div>

        <p className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
          Enter the exact dates the complaint is about. The outcome can only be assessed when this
          period matches the current period of the report you analyse it against. If the two differ,
          the analysis records the complaint as unable to be checked from that evidence and says why,
          rather than answering the wrong question.
        </p>

        <div className="flex flex-col gap-2">
          <TextField
            label="Received"
            error={fieldErrors.receivedAt?.join('; ')}
            type="datetime-local"
            hint="When the complaint reached you, in your own local time."
            value={receivedAt}
            onChange={(event) => setReceivedAt(event.target.value)}
            required
          />
          {/* Filled on request rather than on load, so the field never shows a
              time taken from the rendering server instead of this browser. */}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => setReceivedAt(localDateTimeValue(new Date()))}
          >
            Use the current time
          </Button>
        </div>

        <TextAreaField
          label="What the client said, in their own words"
          error={fieldErrors.originalText?.join('; ')}
          hint="Paste or type the wording exactly as it arrived, including anything that reads like an instruction. It is stored verbatim, quoted back as evidence, and never acted on as an instruction."
          value={originalText}
          maxLength={MAX_COMPLAINT_TEXT}
          onChange={(event) => setOriginalText(event.target.value)}
          required
        />
        <p aria-live="polite" className="-mt-2 text-[11px] text-ink-faint">
          {originalText.length} of {MAX_COMPLAINT_TEXT.toLocaleString('en-US')} characters used.
          {remaining <= 200 ? ` ${remaining.toLocaleString('en-US')} remaining.` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending || clients.length === 0}>
            {pending ? 'Saving...' : 'Save complaint'}
          </Button>
          <span className="text-[11px] text-ink-faint">
            A complaint can be saved before any report exists. It starts as open.
          </span>
        </div>
      </form>
    </Card>
  );
}

/**
 * Status controls live beside the form because both are the client-side half of
 * the complaints screen, which is otherwise server rendered.
 */
export function ComplaintStatusActions({
  complaint,
}: {
  complaint: { id: string; status: ComplaintStatus; revision: number };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleRevision, setStaleRevision] = useState<number | null>(null);

  async function setStatus(next: ComplaintStatus) {
    setPending(true);
    setError(null);
    setStaleRevision(null);
    try {
      const response = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next, expectedRevision: complaint.revision }),
      });

      if (response.status === 409) {
        const body = (await response.json()) as { error?: { latestRevision?: number } };
        setStaleRevision(body.error?.latestRevision ?? null);
        setPending(false);
        return;
      }
      if (!response.ok) {
        const failure = await readError(response);
        setError(failure.message ?? 'The status could not be changed. Nothing was saved.');
        setPending(false);
        return;
      }
      setPending(false);
      router.refresh();
    } catch {
      setError('The status could not be changed, so nothing was saved. Try again.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {complaint.status === 'resolved' ? (
          <Button variant="secondary" disabled={pending} onClick={() => setStatus('open')}>
            {pending ? 'Reopening...' : 'Reopen'}
          </Button>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={() => setStatus('resolved')}>
            {pending ? 'Resolving...' : 'Mark resolved'}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-negative">
          {error}
        </p>
      ) : null}
      {staleRevision !== null ? (
        <div role="alert" className="flex flex-col items-start gap-1">
          <p className="text-[11px] leading-relaxed text-caution">
            Someone else changed this complaint while the page was open (it is now at revision{' '}
            {staleRevision}). Nothing was overwritten.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              setStaleRevision(null);
              router.refresh();
            }}
          >
            Reload to see the current state
          </Button>
        </div>
      ) : null}
    </div>
  );
}
