'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField, TextAreaField, SelectField, ErrorSummary } from '@/components/ui/fields';
import { Card, CardHeader, Badge, ErrorState, NotProvided } from '@/components/ui/primitives';
import { TEMPLATE_DEFINITIONS } from '@/features/imports/templates';
import {
  DatasetProvenance,
  FormsManualEntry,
  OrganicManualEntry,
  OutcomesManualEntry,
  blankPeriodSources,
  type PeriodSourcesValue,
} from '@/features/imports/manual-entry';
import {
  ValidationPreview,
  DATASET_LABELS,
  type DatasetKey,
  type RowErrorView,
} from '@/features/imports/validation-preview';

/**
 * The import wizard.
 *
 * Two rules shape the whole flow. A CSV upload and manual entry write into the
 * same draft payload, so neither route can produce a different canonical value
 * for the same input. And a commit is only ever offered for content the server
 * has just validated: any edit resets the draft and clears its content hash, so
 * the wizard sends the user back through validation rather than committing
 * something the server never checked.
 */

export type MetadataValue = {
  reportLabel: string;
  currentStart: string;
  currentEnd: string;
  baselineStart: string;
  baselineEnd: string;
  timeZone: string;
  channel: 'organic_search';
  propertyLabel: string;
  leadDefinition: string;
  leadEventName: string | null;
  trackingStatus: string;
  trackingEvidenceNote: string | null;
  trackingReviewedAt: string | null;
  trackingReviewedBy: string | null;
};

export type DraftPayloadShape = {
  metadata?: MetadataValue;
  datasets?: Partial<Record<DatasetKey, unknown[] | null>>;
  sources?: Partial<Record<DatasetKey, PeriodSourcesValue | null>>;
  selectedForm?: { formId: string; scope: string } | null;
  formDefinitionAcknowledged?: boolean;
  trendGranularity?: string | null;
  /** Carried in the payload so a resumed draft still knows what it corrects. */
  supersedesReportId?: string | null;
  files?: Record<
    string,
    { name: string; contentHash: string; byteCount: number; rowCount: number }
  >;
};

export type DraftView = {
  id: string;
  clientId: string;
  payload: DraftPayloadShape;
  state: 'draft' | 'validated' | 'committed' | 'deleted';
  contentHash: string | null;
  validation: { ok: boolean; errors: RowErrorView[]; totalErrorCount: number } | null;
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

export type WizardClient = {
  id: string;
  name: string;
  timeZone: string;
  propertyLabel: string;
  leadDefinition: string;
  leadEventName: string | null;
};

type Failure = {
  code: string;
  message: string;
  fields: Record<string, string[]>;
  latestRevision: number | null;
};

const TEMPLATE_FILES: Record<string, string> = {
  organic: '/templates/organic-summary.csv',
  keywords: '/templates/keywords.csv',
  forms: '/templates/forms.csv',
  landingPages: '/templates/landing-pages.csv',
  trafficTrend: '/templates/traffic-trend.csv',
};

const DEFAULT_SOURCE_KIND: Record<DatasetKey, string> = {
  organic: 'ga4_export',
  keywords: 'rank_tracker',
  forms: 'form_backend',
  landingPages: 'ga4_export',
  trafficTrend: 'ga4_export',
  outcomes: 'crm',
};

const OPTIONAL_DATASETS: DatasetKey[] = ['keywords', 'forms', 'landingPages', 'trafficTrend'];

const STEPS = [
  'Client and period',
  'Organic summary',
  'Optional evidence',
  'Validation',
  'Commit',
] as const;

function blankMetadata(client: WizardClient | undefined): MetadataValue {
  return {
    reportLabel: '',
    currentStart: '',
    currentEnd: '',
    baselineStart: '',
    baselineEnd: '',
    timeZone: client?.timeZone ?? '',
    channel: 'organic_search',
    propertyLabel:
      client?.propertyLabel ||
      // A new client has no saved definitions yet. Naming the property
      // after the client is a better default than an empty required box.
      (client ? client.name : ''),
    leadDefinition: client?.leadDefinition ?? '',
    leadEventName: client?.leadEventName ?? null,
    trackingStatus: 'unverified',
    trackingEvidenceNote: null,
    trackingReviewedAt: null,
    trackingReviewedBy: null,
  };
}

const NETWORK_FAILURE: Failure = {
  code: 'NETWORK',
  message:
    'That request could not be sent. Nothing you typed has been lost; try again once the connection is back.',
  fields: {},
  latestRevision: null,
};

async function readFailure(response: Response): Promise<Failure> {
  let code = 'INTERNAL';
  let message = 'That could not be saved. Nothing you typed has been lost.';
  let fields: Record<string, string[]> = {};
  let latestRevision: number | null = null;
  try {
    const body = await response.json();
    code = body?.error?.code ?? code;
    message = body?.error?.message ?? message;
    fields = body?.error?.fields ?? {};
    latestRevision =
      typeof body?.error?.latestRevision === 'number' ? body.error.latestRevision : null;
  } catch {
    // A body that is not JSON keeps the generic message above.
  }
  if (code === 'FORBIDDEN') message = 'Your role does not allow this action.';
  return { code, message, fields, latestRevision };
}

export function ImportWizard({
  clients,
  initialClientId,
  initialDraft,
  prefillMetadata,
  supersedesReportId,
  returnPath = null,
  limits,
}: {
  clients: WizardClient[];
  initialClientId: string | null;
  initialDraft: DraftView | null;
  prefillMetadata: MetadataValue | null;
  supersedesReportId: string | null;
  /** Already sanitised by the route: a same-origin path, or null. */
  returnPath?: string | null;
  limits: { maxBytes: number; maxRows: number; maxReportedErrors: number };
}) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState(
    initialDraft?.clientId ?? initialClientId ?? clients[0]?.id ?? '',
  );
  const [draft, setDraft] = useState<DraftView | null>(initialDraft);
  const [staged, setStaged] = useState<DraftPayloadShape>(initialDraft?.payload ?? {});
  const [metadata, setMetadata] = useState<MetadataValue>(
    () =>
      initialDraft?.payload?.metadata ??
      prefillMetadata ??
      blankMetadata(clients.find((client) => client.id === (initialClientId ?? clients[0]?.id))),
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadNotes, setUploadNotes] = useState<Record<string, string>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, RowErrorView[]>>({});

  // One user action keeps one key across every retry of that action. The key is
  // tied to the exact content being committed, so a genuinely different commit
  // gets a new one rather than replaying the previous result.
  const commitKey = useRef<{ hash: string; key: string } | null>(null);

  const client = clients.find((candidate) => candidate.id === clientId);
  const validation = draft?.validation ?? null;
  const validated = draft?.state === 'validated' && draft.contentHash !== null;

  function applyDraft(next: DraftView) {
    setDraft(next);
    setStaged(next.payload ?? {});
  }

  /**
   * Creates the draft on first save. The client is fixed from that moment on.
   *
   * The working copy is deliberately not replaced by the new draft's empty
   * payload, so anything typed before the first save survives.
   */
  async function ensureDraft(): Promise<DraftView | null> {
    if (draft) return draft;
    if (!clientId) {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'Choose a client before saving.',
        fields: {},
        latestRevision: null,
      });
      return null;
    }
    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (!response.ok) {
        setFailure(await readFailure(response));
        return null;
      }
      const body = await response.json();
      const created = body.data as DraftView;
      setDraft(created);
      return created;
    } catch {
      setFailure(NETWORK_FAILURE);
      return null;
    }
  }

  /**
   * Saves the working copy.
   *
   * The whole `datasets` and `sources` objects are always sent, because the
   * server merges a patch at the top level only: sending one dataset alone
   * would drop the others. The response is then adopted wholesale, so the
   * working copy and the stored draft cannot drift apart.
   */
  async function saveStaged(
    current: DraftView,
    overrides: Partial<DraftPayloadShape> = {},
    revisionOverride?: number,
  ): Promise<DraftView | null> {
    const body = {
      expectedRevision: revisionOverride ?? current.revision,
      metadata,
      datasets: staged.datasets ?? {},
      sources: staged.sources ?? {},
      selectedForm: staged.selectedForm ?? null,
      formDefinitionAcknowledged: staged.formDefinitionAcknowledged ?? false,
      trendGranularity: staged.trendGranularity ?? null,
      files: staged.files ?? {},
      // Kept in the payload so a resumed draft still knows what it corrects.
      supersedesReportId: supersedesReportId ?? staged.supersedesReportId ?? null,
      ...overrides,
    };
    try {
      const response = await fetch(`/api/imports/${current.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setFailure(await readFailure(response));
        return null;
      }
      const parsed = await response.json();
      const next = parsed.data as DraftView;
      applyDraft(next);
      return next;
    } catch {
      setFailure(NETWORK_FAILURE);
      return null;
    }
  }

  async function saveAndAdvance(target: number) {
    setBusy('save');
    setFailure(null);
    try {
      const current = await ensureDraft();
      if (!current) return;

      // The provenance editor shows a blank source until someone types in it,
      // but the payload only gained `sources.organic` on the first keystroke.
      // Leaving a required dataset with the source key absent made validation
      // report "expected object, received undefined" against the whole
      // dataset, which tells the reader nothing about which box to fill.
      // Materialising the blank means validation names the individual fields.
      if (target >= 2 && !staged.sources?.organic) {
        setStaged((value) => ({
          ...value,
          sources: {
            ...(value.sources ?? {}),
            organic: blankPeriodSources(DEFAULT_SOURCE_KIND.organic),
          },
        }));
        const saved = await saveStaged(current, {
          sources: {
            ...(staged.sources ?? {}),
            organic: blankPeriodSources(DEFAULT_SOURCE_KIND.organic),
          },
        });
        if (saved) setStep(target);
        return;
      }

      const saved = await saveStaged(current);
      if (saved) setStep(target);
    } finally {
      setBusy(null);
    }
  }

  /** Retries the last save against the revision the server reported. */
  async function saveOverLatest() {
    if (!draft || failure?.latestRevision === null || failure?.latestRevision === undefined) return;
    setBusy('save');
    try {
      const saved = await saveStaged(draft, {}, failure.latestRevision);
      if (saved) setFailure(null);
    } finally {
      setBusy(null);
    }
  }

  async function reloadFromServer() {
    if (!draft) return;
    setBusy('reload');
    try {
      const response = await fetch(`/api/imports/${draft.id}`);
      if (!response.ok) {
        setFailure(await readFailure(response));
        return;
      }
      const body = await response.json();
      applyDraft(body.data as DraftView);
      setFailure(null);
    } catch {
      setFailure(NETWORK_FAILURE);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Uploads one CSV. The working copy is saved first so an upload response,
   * which returns the whole merged payload, cannot overwrite unsaved entries.
   */
  async function upload(dataset: DatasetKey, file: File) {
    setBusy(`upload:${dataset}`);
    setFailure(null);
    try {
      const current = await ensureDraft();
      if (!current) return;
      const saved = await saveStaged(current);
      if (!saved) return;

      const form = new FormData();
      form.append('dataset', dataset);
      form.append('file', file);
      form.append('expectedRevision', String(saved.revision));

      // No content-type header here: the browser sets the multipart boundary.
      const response = await fetch(`/api/imports/${saved.id}/files`, { method: 'POST', body: form });
      if (!response.ok) {
        setFailure(await readFailure(response));
        return;
      }
      const body = await response.json();
      const result = body.data as DraftView & {
        upload: { ok: boolean; errors: RowErrorView[]; totalErrorCount: number; rowCount: number };
      };

      // A rejected file leaves the draft untouched, so the note explains why
      // rather than the draft silently staying as it was.
      if (!result.upload.ok) {
        const first = result.upload.errors[0];
        // The message alone says what rule broke. Naming the column and
        // quoting the rejected value is what tells the reader which cell to
        // go and fix.
        const where = first
          ? [
              first.row !== null ? `row ${first.row}` : null,
              first.field ? `column "${first.field}"` : null,
              first.value !== null && first.value !== '' ? `value "${first.value}"` : null,
            ]
              .filter(Boolean)
              .join(', ')
          : '';
        setUploadNotes((notes) => ({
          ...notes,
          [dataset]:
            `That file was not accepted and nothing changed. ` +
            `${result.upload.totalErrorCount} problem${result.upload.totalErrorCount === 1 ? '' : 's'} found` +
            (first ? `, starting with: ${first.message}` : '') +
            (where ? ` (${where})` : '') +
            (result.upload.totalErrorCount > result.upload.errors.length
              ? ` Only the first ${result.upload.errors.length} are listed.`
              : ''),
        }));
        setUploadErrors((current) => ({ ...current, [dataset]: result.upload.errors }));
        return;
      }

      setUploadErrors((current) => ({ ...current, [dataset]: [] }));
      applyDraft(result);
      setUploadNotes((notes) => ({
        ...notes,
        [dataset]: `${result.upload.rowCount} rows read from ${file.name}.`,
      }));
    } catch {
      setFailure(NETWORK_FAILURE);
    } finally {
      setBusy(null);
    }
  }

  async function runValidation() {
    setBusy('validate');
    setFailure(null);
    try {
      const current = await ensureDraft();
      if (!current) return;
      const saved = await saveStaged(current);
      if (!saved) return;

      const response = await fetch(`/api/imports/${saved.id}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: saved.revision }),
      });
      if (!response.ok) {
        setFailure(await readFailure(response));
        return;
      }
      const body = await response.json();
      const result = body.data as DraftView & {
        ok: boolean;
        errors: RowErrorView[];
        totalErrorCount: number;
      };
      applyDraft({
        ...result,
        validation: {
          ok: result.ok,
          errors: result.errors,
          totalErrorCount: result.totalErrorCount,
        },
      });
    } catch {
      setFailure(NETWORK_FAILURE);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!draft || !draft.contentHash) return;
    setBusy('commit');
    setFailure(null);

    if (commitKey.current === null || commitKey.current.hash !== draft.contentHash) {
      commitKey.current = { hash: draft.contentHash, key: crypto.randomUUID() };
    }

    try {
      const response = await fetch(`/api/imports/${draft.id}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': commitKey.current.key },
        body: JSON.stringify({
          expectedRevision: draft.revision,
          contentHash: draft.contentHash,
          supersedesReportId: supersedesReportId ?? staged.supersedesReportId ?? null,
        }),
      });

      if (!response.ok) {
        const problem = await readFailure(response);
        // A key already spent on a different request needs a fresh one, not a
        // retry of the same identity.
        if (problem.code === 'IDEMPOTENCY_CONFLICT') commitKey.current = null;
        setFailure(problem);
        setBusy(null);
        return;
      }

      const body = await response.json();
      // The key is kept: a retry of this same action must replay, not create a
      // second report. Busy stays set while the navigation happens.
      // Back to the screen that sent us here, when there was one. Creating an
      // analysis is the case that matters: without this the reader lands on the
      // report and has to find their way back and reselect the complaint.
      router.push(returnPath ?? `/reports/${body.data.id}`);
    } catch {
      setFailure(NETWORK_FAILURE);
      setBusy(null);
    }
  }

  async function discard() {
    if (!draft) return;
    setBusy('discard');
    try {
      // 204 with no body, so nothing is parsed here.
      const response = await fetch(`/api/imports/${draft.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setFailure(await readFailure(response));
        setBusy(null);
        return;
      }
      router.push('/clients');
    } catch {
      setFailure(NETWORK_FAILURE);
      setBusy(null);
    }
  }

  const datasetRows = (key: DatasetKey) => {
    const rows = staged.datasets?.[key];
    return Array.isArray(rows) ? rows.length : null;
  };

  function setSource(key: DatasetKey, value: PeriodSourcesValue) {
    setStaged((current) => ({ ...current, sources: { ...(current.sources ?? {}), [key]: value } }));
  }

  function setDataset(key: DatasetKey, rows: unknown[] | null) {
    setStaged((current) => ({
      ...current,
      datasets: { ...(current.datasets ?? {}), [key]: rows },
      // A removed dataset must not leave provenance behind describing rows that
      // are no longer there.
      sources: { ...(current.sources ?? {}), [key]: rows === null ? null : current.sources?.[key] },
      // Rows typed by hand are no longer backed by the uploaded file, so its
      // provenance is dropped rather than left claiming something untrue.
      files: Object.fromEntries(
        Object.entries(current.files ?? {}).filter(([dataset]) => dataset !== key),
      ),
    }));
  }

  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold text-ink">Import a report</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {supersedesReportId
              ? 'A correction. The original report stays exactly as committed; this becomes a new report that supersedes it.'
              : 'Five documented CSV templates, or the same fields typed by hand. Provider exports are not read directly.'}
          </p>
        </div>
        {draft ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={validated ? 'positive' : 'caution'}>
              {draft.state === 'validated' ? 'Validated' : 'Draft'}
            </Badge>
            <Button variant="danger" onClick={discard} disabled={busy !== null}>
              <Trash2 size={14} aria-hidden />
              Discard draft
            </Button>
          </div>
        ) : null}
      </div>

      <ol className="mb-5 flex flex-wrap gap-2" aria-label="Import steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? 'step' : undefined}
              className={`min-h-[44px] rounded-[10px] border px-3 text-[12px] ${
                index === step
                  ? 'border-accent bg-accent text-white'
                  : 'border-line text-ink-muted hover:text-ink'
              }`}
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {failure ? (
        <div className="mb-4 flex flex-col gap-2">
          <ErrorState
            title={
              failure.code === 'REVISION_CONFLICT'
                ? 'Someone changed this draft'
                : 'That did not go through'
            }
            description={
              failure.code === 'REVISION_CONFLICT'
                ? 'Someone else changed this draft since you loaded it. Nothing you typed has been discarded. Choose whether to take their version or save yours over it.'
                : failure.message
            }
          />
          {failure.code === 'REVISION_CONFLICT' ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={reloadFromServer} disabled={busy !== null}>
                Load their version
              </Button>
              <Button variant="primary" onClick={saveOverLatest} disabled={busy !== null}>
                Keep my values and save over it
              </Button>
            </div>
          ) : null}
          <ErrorSummary errors={failure.fields} />
        </div>
      ) : null}

      {draft && draft.state === 'draft' && draft.contentHash === null && validation !== null ? (
        <Card className="mb-4 border-caution/40">
          <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
            This draft changed after it was last validated. Run validation again before committing;
            the previous result no longer describes what is here.
          </p>
        </Card>
      ) : null}

      {step === 0 ? (
        <StepOne
          clients={clients}
          clientId={clientId}
          onClientChange={(next) => {
            setClientId(next);
            const chosen = clients.find((candidate) => candidate.id === next);
            // Prefill only the fields the client record already answers.
            setMetadata((current) => ({
              ...current,
              timeZone: current.timeZone || (chosen?.timeZone ?? ''),
              propertyLabel:
                current.propertyLabel ||
                chosen?.propertyLabel ||
                (chosen ? chosen.name : ''),
              leadDefinition: current.leadDefinition || (chosen?.leadDefinition ?? ''),
              leadEventName: current.leadEventName ?? chosen?.leadEventName ?? null,
            }));
          }}
          locked={draft !== null}
          metadata={metadata}
          onMetadataChange={setMetadata}
          onContinue={() => saveAndAdvance(1)}
          busy={busy !== null}
        />
      ) : null}

      {step === 1 ? (
        <StepTwo
          rows={staged.datasets?.organic ?? null}
          rowCount={datasetRows('organic')}
          fileNote={staged.files?.organic}
          uploadNote={uploadNotes.organic}
          uploadErrors={uploadErrors.organic}
          limits={limits}
          source={staged.sources?.organic ?? blankPeriodSources(DEFAULT_SOURCE_KIND.organic)}
          onSourceChange={(value) => setSource('organic', value)}
          onRowsChange={(rows) => setDataset('organic', rows)}
          onUpload={(file) => upload('organic', file)}
          onContinue={() => saveAndAdvance(2)}
          onBack={() => setStep(0)}
          busy={busy}
        />
      ) : null}

      {step === 2 ? (
        <StepThree
          staged={staged}
          uploadNotes={uploadNotes}
          uploadErrors={uploadErrors}
          limits={limits}
          onUpload={upload}
          onSourceChange={setSource}
          onDatasetChange={setDataset}
          onSelectedFormChange={(value) =>
            setStaged((current) => ({ ...current, selectedForm: value }))
          }
          onAcknowledgeChange={(value) =>
            setStaged((current) => ({ ...current, formDefinitionAcknowledged: value }))
          }
          onGranularityChange={(value) =>
            setStaged((current) => ({ ...current, trendGranularity: value }))
          }
          onContinue={() => saveAndAdvance(3)}
          onBack={() => setStep(1)}
          busy={busy}
        />
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <ValidationPreview
            state={
              validation === null ? 'unvalidated' : validation.ok && validated ? 'passed' : 'failed'
            }
            errors={validation?.errors ?? []}
            totalErrorCount={validation?.totalErrorCount ?? 0}
            reportedLimit={limits.maxReportedErrors}
            payload={staged}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStep(2)} disabled={busy !== null}>
              Back
            </Button>
            <Button variant="primary" onClick={runValidation} disabled={busy !== null}>
              {busy === 'validate' ? 'Validating...' : 'Save and validate'}
            </Button>
            <Button onClick={() => setStep(4)} disabled={!validated || busy !== null}>
              Continue to commit
            </Button>
          </div>
          {!validated ? (
            <p className="text-[12px] text-ink-faint">
              Commit stays unavailable until the server has accepted every value.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader title="Commit this report" />
          <div className="flex flex-col gap-3 px-4 pb-4">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Committing writes an immutable report. It cannot be edited afterwards; a mistake is
              corrected by importing a new report that supersedes it, which keeps both on record.
            </p>
            <dl className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
              <dt className="text-ink-faint">Client</dt>
              <dd className="text-ink">{client?.name ?? <NotProvided />}</dd>
              <dt className="text-ink-faint">Report label</dt>
              <dd className="text-ink">{metadata.reportLabel || <NotProvided />}</dd>
              <dt className="text-ink-faint">Current period</dt>
              <dd className="text-ink">
                {metadata.currentStart && metadata.currentEnd ? (
                  `${metadata.currentStart} to ${metadata.currentEnd}`
                ) : (
                  <NotProvided />
                )}
              </dd>
              <dt className="text-ink-faint">Baseline period</dt>
              <dd className="text-ink">
                {metadata.baselineStart && metadata.baselineEnd ? (
                  `${metadata.baselineStart} to ${metadata.baselineEnd}`
                ) : (
                  <NotProvided />
                )}
              </dd>
              <dt className="text-ink-faint">Validated content</dt>
              <dd className="break-all text-ink">{draft?.contentHash ?? <NotProvided />}</dd>
              <dt className="text-ink-faint">Supersedes</dt>
              <dd className="break-all text-ink">{supersedesReportId ?? <NotProvided>No predecessor</NotProvided>}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStep(3)} disabled={busy !== null}>
                Back
              </Button>
              <Button variant="primary" onClick={commit} disabled={!validated || busy !== null}>
                {busy === 'commit' ? 'Committing...' : 'Commit report'}
              </Button>
            </div>
            {!validated ? (
              <p className="text-[12px] text-caution">
                This draft is not validated. Go back and validate it; a commit is refused otherwise.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function StepOne({
  clients,
  clientId,
  onClientChange,
  locked,
  metadata,
  onMetadataChange,
  onContinue,
  busy,
}: {
  clients: WizardClient[];
  clientId: string;
  onClientChange: (id: string) => void;
  locked: boolean;
  metadata: MetadataValue;
  onMetadataChange: (next: MetadataValue) => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof MetadataValue>(key: K, value: MetadataValue[K]) =>
    onMetadataChange({ ...metadata, [key]: value });

  return (
    <Card>
      <CardHeader title="Client, periods and definitions" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <SelectField
          label="Client"
          value={clientId}
          disabled={locked}
          hint={
            locked
              ? 'The client is fixed once a draft exists. Discard this draft to import for a different client.'
              : 'Only clients that are not archived can receive a new import.'
          }
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
          onChange={(event) => onClientChange(event.target.value)}
        />

        <TextField
          label="Report label"
          hint="How this report is named in lists, for example 10 August 2026 Report."
          value={metadata.reportLabel}
          onChange={(event) => set('reportLabel', event.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[12px] font-medium text-ink-muted">Current period</legend>
            <div className="flex flex-col gap-3">
              <TextField
                label="Start"
                type="date"
                value={metadata.currentStart}
                onChange={(event) => set('currentStart', event.target.value)}
              />
              <TextField
                label="End"
                type="date"
                value={metadata.currentEnd}
                onChange={(event) => set('currentEnd', event.target.value)}
              />
            </div>
          </fieldset>
          <fieldset className="rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[12px] font-medium text-ink-muted">Baseline period</legend>
            <div className="flex flex-col gap-3">
              <TextField
                label="Start"
                type="date"
                value={metadata.baselineStart}
                onChange={(event) => set('baselineStart', event.target.value)}
              />
              <TextField
                label="End"
                type="date"
                value={metadata.baselineEnd}
                onChange={(event) => set('baselineEnd', event.target.value)}
              />
            </div>
          </fieldset>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Report time zone"
            hint="Both windows are read in this IANA zone."
            value={metadata.timeZone}
            onChange={(event) => set('timeZone', event.target.value)}
          />
          <TextField
            label="Channel"
            value="Organic search"
            readOnly
            hint="Release 1 compares organic search only, so this cannot be changed."
          />
          <TextField
            label="Property label"
            value={metadata.propertyLabel}
            onChange={(event) => set('propertyLabel', event.target.value)}
          />
          <TextField
            label="Lead event name"
            hint="Optional. The event key in the analytics property."
            value={metadata.leadEventName ?? ''}
            onChange={(event) =>
              set('leadEventName', event.target.value.trim() === '' ? null : event.target.value)
            }
          />
        </div>

        <TextAreaField
          label="Lead definition"
          hint="What counts as a lead for this report. This wording is stored with the report and repeated back to the client."
          value={metadata.leadDefinition}
          onChange={(event) => set('leadDefinition', event.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Tracking status"
            hint="Whether the lead tracking behind these numbers has been checked."
            value={metadata.trackingStatus}
            options={[
              { value: 'verified', label: 'Verified' },
              { value: 'unverified', label: 'Unverified' },
              { value: 'known_issue', label: 'Known issue' },
            ]}
            onChange={(event) => set('trackingStatus', event.target.value)}
          />
          <TextField
            label="Tracking reviewed by"
            value={metadata.trackingReviewedBy ?? ''}
            onChange={(event) =>
              set(
                'trackingReviewedBy',
                event.target.value.trim() === '' ? null : event.target.value,
              )
            }
          />
        </div>

        <TextAreaField
          label="Tracking evidence note"
          hint="What was checked, and how. Leave blank if nothing was checked; blank is recorded as unknown."
          value={metadata.trackingEvidenceNote ?? ''}
          onChange={(event) =>
            set(
              'trackingEvidenceNote',
              event.target.value.trim() === '' ? null : event.target.value,
            )
          }
        />

        <div>
          <Button variant="primary" onClick={onContinue} disabled={busy}>
            {busy ? 'Saving...' : 'Save and continue'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** The template's own columns and rules, so the file format is never guessed. */
function TemplateGuide({ dataset }: { dataset: DatasetKey }) {
  const definition = TEMPLATE_DEFINITIONS.find((entry) => entry.dataset === dataset);
  const href = TEMPLATE_FILES[dataset];
  if (!definition || !href) return null;

  return (
    <details className="rounded-[10px] border border-line px-3 py-2">
      <summary className="min-h-[28px] cursor-pointer text-[12px] text-ink-muted">
        {definition.title}: columns and rules
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {/* A plain anchor: the template is a static file, not an application route. */}
        <a
          href={href}
          download
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-surface-raised px-4 text-[13px] font-medium text-ink hover:border-ink-faint"
        >
          <Download size={14} aria-hidden />
          Download the template
        </a>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
            <caption className="sr-only">Columns accepted in the {definition.title} template</caption>
            <thead>
              <tr className="border-b border-line text-ink-faint">
                <th scope="col" className="py-2 pr-3 font-medium">Column</th>
                <th scope="col" className="py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {definition.columns.map((column) => (
                <tr key={column.name} className="border-b border-line/60 align-top last:border-0">
                  <td className="py-2 pr-3 font-mono text-ink">{column.name}</td>
                  <td className="py-2 leading-relaxed text-ink-muted">
                    {column.description}
                    {column.values ? ` One of: ${column.values.join(', ')}.` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-ink-muted">
          {definition.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function UploadRow({
  dataset,
  onUpload,
  busy,
  note,
  errors,
  fileNote,
  limits,
}: {
  dataset: DatasetKey;
  onUpload: (file: File) => void;
  busy: string | null;
  note?: string;
  errors?: RowErrorView[];
  fileNote?: { name: string; contentHash: string; byteCount: number; rowCount: number };
  limits: { maxBytes: number; maxRows: number };
}) {
  const inputId = `upload-${dataset}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-[12px] font-medium text-ink-muted">
        Upload a {DATASET_LABELS[dataset]} CSV
      </label>
      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        disabled={busy !== null}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          // Clearing lets the same file be chosen again after a correction.
          event.target.value = '';
        }}
        className="min-h-[44px] w-full rounded-[10px] border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-[8px] file:border-0 file:bg-surface-raised file:px-3 file:py-2 file:text-[12px] file:text-ink"
      />
      <p className="text-[11px] leading-relaxed text-ink-faint">
        Up to {Math.round(limits.maxBytes / (1024 * 1024))} MiB and{' '}
        {limits.maxRows.toLocaleString('en-US')} rows. The uploaded bytes are discarded once the
        rows are read; the file name and a hash of it are kept as provenance.
      </p>
      {busy === `upload:${dataset}` ? (
        <p className="text-[12px] text-ink-muted">
          <Upload size={13} aria-hidden className="mr-1 inline" />
          Reading the file...
        </p>
      ) : null}
      {note ? <p className="text-[12px] text-ink">{note}</p> : null}
      {errors && errors.length > 0 ? (
        <div className="overflow-x-auto rounded-[10px] border border-negative/40">
          <table className="w-full min-w-[360px] border-collapse text-left text-[11px]">
            <caption className="sr-only">
              Rejected cells in the uploaded {DATASET_LABELS[dataset]} file
            </caption>
            <thead>
              <tr className="border-b border-line text-ink-faint">
                <th scope="col" className="px-2 py-1.5 font-medium">Row</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Column</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Value</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Problem</th>
              </tr>
            </thead>
            <tbody>
              {errors.slice(0, 20).map((error, index) => (
                <tr key={`${error.row}-${error.field}-${index}`} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-1.5 text-ink-muted">{error.row ?? 'file'}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{error.field ?? 'not stated'}</td>
                  {/* The rejected value verbatim, so the reader knows which
                      cell to correct rather than only which rule broke. */}
                  <td className="px-2 py-1.5 font-mono text-ink">
                    {error.value === null || error.value === '' ? '(blank)' : error.value}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.length > 20 ? (
            <p className="px-2 py-1.5 text-[11px] text-ink-faint">
              Showing the first 20 of {errors.length} reported problems.
            </p>
          ) : null}
        </div>
      ) : null}
      {fileNote ? (
        <p className="text-[11px] text-ink-faint">
          From {fileNote.name}: {fileNote.rowCount} rows, {fileNote.byteCount} bytes, SHA-256{' '}
          {fileNote.contentHash.slice(0, 16)}...
        </p>
      ) : null}
    </div>
  );
}

function StepTwo({
  rows,
  uploadErrors,
  rowCount,
  fileNote,
  uploadNote,
  limits,
  source,
  onSourceChange,
  onRowsChange,
  onUpload,
  onContinue,
  onBack,
  busy,
}: {
  rows: unknown[] | null;
  rowCount: number | null;
  fileNote?: { name: string; contentHash: string; byteCount: number; rowCount: number };
  uploadNote?: string;
  uploadErrors?: RowErrorView[];
  limits: { maxBytes: number; maxRows: number; maxReportedErrors: number };
  source: PeriodSourcesValue;
  onSourceChange: (value: PeriodSourcesValue) => void;
  onRowsChange: (rows: unknown[]) => void;
  onUpload: (file: File) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: string | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Organic summary"
        action={
          rowCount === null ? (
            <Badge tone="caution">Required</Badge>
          ) : (
            <Badge tone="positive">{rowCount} rows</Badge>
          )
        }
      />
      <div className="flex flex-col gap-5 px-4 pb-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Every report needs one baseline row and one current row. Upload the template or type the
          same three numbers by hand; both routes write identical values.
        </p>
        <TemplateGuide dataset="organic" />
        <UploadRow
          dataset="organic"
          onUpload={onUpload}
          busy={busy}
          note={uploadNote}
          errors={uploadErrors}
          fileNote={fileNote}
          limits={limits}
        />
        <OrganicManualEntry
          key={fileNote?.contentHash ?? 'manual'}
          rows={rows}
          onChange={onRowsChange}
        />
        <DatasetProvenance
          title="Organic summary"
          value={source}
          onChange={onSourceChange}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBack} disabled={busy !== null}>
            Back
          </Button>
          <Button variant="primary" onClick={onContinue} disabled={busy !== null}>
            {busy === 'save' ? 'Saving...' : 'Save and continue'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function StepThree({
  staged,
  uploadNotes,
  uploadErrors,
  limits,
  onUpload,
  onSourceChange,
  onDatasetChange,
  onSelectedFormChange,
  onAcknowledgeChange,
  onGranularityChange,
  onContinue,
  onBack,
  busy,
}: {
  staged: DraftPayloadShape;
  uploadNotes: Record<string, string>;
  uploadErrors: Record<string, RowErrorView[]>;
  limits: { maxBytes: number; maxRows: number; maxReportedErrors: number };
  onUpload: (dataset: DatasetKey, file: File) => void;
  onSourceChange: (dataset: DatasetKey, value: PeriodSourcesValue) => void;
  onDatasetChange: (dataset: DatasetKey, rows: unknown[] | null) => void;
  onSelectedFormChange: (value: { formId: string; scope: string } | null) => void;
  onAcknowledgeChange: (value: boolean) => void;
  onGranularityChange: (value: string | null) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: string | null;
}) {
  const formRows = (staged.datasets?.forms ?? []) as Array<Record<string, unknown>>;
  const formIds = Array.from(
    new Set(formRows.map((row) => String(row.formId ?? '')).filter((id) => id !== '')),
  );
  const selected = staged.selectedForm ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Optional evidence" />
        <p className="px-4 pb-4 text-[13px] leading-relaxed text-ink-muted">
          None of this is required. Anything left out is recorded as a named gap on the report, and
          is never treated as a zero.
        </p>
      </Card>

      {OPTIONAL_DATASETS.map((dataset) => {
        const rows = staged.datasets?.[dataset];
        const count = Array.isArray(rows) ? rows.length : null;
        return (
          <Card key={dataset}>
            <CardHeader
              title={DATASET_LABELS[dataset]}
              action={
                count === null ? (
                  <Badge>Not supplied</Badge>
                ) : (
                  <Badge tone="positive">{count} rows</Badge>
                )
              }
            />
            <div className="flex flex-col gap-4 px-4 pb-4">
              <TemplateGuide dataset={dataset} />
              <UploadRow
                dataset={dataset}
                onUpload={(file) => onUpload(dataset, file)}
                busy={busy}
                note={uploadNotes[dataset]}
                errors={uploadErrors[dataset]}
                fileNote={staged.files?.[dataset]}
                limits={limits}
              />
              {dataset === 'forms' ? (
                <FormsManualEntry
                  key={staged.files?.forms?.contentHash ?? 'manual'}
                  rows={staged.datasets?.forms ?? null}
                  onChange={(next) => onDatasetChange('forms', next)}
                />
              ) : null}
              {count !== null ? (
                <DatasetProvenance
                  title={DATASET_LABELS[dataset]}
                  value={
                    staged.sources?.[dataset] ?? blankPeriodSources(DEFAULT_SOURCE_KIND[dataset])
                  }
                  onChange={(value) => onSourceChange(dataset, value)}
                />
              ) : (
                <p className="text-[12px] text-ink-faint">
                  Provenance is asked for once this dataset has rows.
                </p>
              )}
              {count !== null ? (
                <div>
                  <Button variant="danger" onClick={() => onDatasetChange(dataset, null)}>
                    <Trash2 size={14} aria-hidden />
                    Remove this dataset from the draft
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        );
      })}

      <Card>
        <CardHeader title="Form selection and trend granularity" />
        <div className="flex flex-col gap-4 px-4 pb-4">
          <SelectField
            label="Form used for the post-click rule"
            hint="One form and one scope only. Other imported forms stay visible but their rates are never pooled."
            value={selected ? `${selected.formId}|${selected.scope}` : ''}
            options={[
              { value: '', label: 'No form selected' },
              ...formIds.flatMap((formId) => [
                { value: `${formId}|organic_search`, label: `${formId} - organic search` },
                { value: `${formId}|all_channels`, label: `${formId} - all channels` },
              ]),
            ]}
            onChange={(event) => {
              if (event.target.value === '') {
                onSelectedFormChange(null);
                return;
              }
              const [formId, scope] = event.target.value.split('|');
              onSelectedFormChange({ formId, scope });
            }}
          />
          <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
            <input
              type="checkbox"
              checked={staged.formDefinitionAcknowledged ?? false}
              onChange={(event) => onAcknowledgeChange(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            I have confirmed that attempts and failed attempts come from one instrumentation source
            and mean the same thing in both periods
          </label>
          <SelectField
            label="Trend granularity"
            hint="What each supplied trend bucket covers. Left unstated, the dashboard says trend data was not provided."
            value={staged.trendGranularity ?? ''}
            options={[
              { value: '', label: 'Not stated' },
              { value: 'day', label: 'Daily buckets' },
              { value: 'period', label: 'Whole-period buckets' },
            ]}
            onChange={(event) =>
              onGranularityChange(event.target.value === '' ? null : event.target.value)
            }
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Business outcomes"
          action={
            Array.isArray(staged.datasets?.outcomes) ? (
              <Badge tone="positive">{staged.datasets.outcomes.length} rows</Badge>
            ) : (
              <Badge>Not supplied</Badge>
            )
          }
        />
        <div className="flex flex-col gap-4 px-4 pb-4">
          <OutcomesManualEntry
            rows={staged.datasets?.outcomes ?? null}
            onChange={(next) => onDatasetChange('outcomes', next)}
          />
          {Array.isArray(staged.datasets?.outcomes) ? (
            <DatasetProvenance
              title="Business outcomes"
              value={staged.sources?.outcomes ?? blankPeriodSources(DEFAULT_SOURCE_KIND.outcomes)}
              onChange={(value) => onSourceChange('outcomes', value)}
            />
          ) : null}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onBack} disabled={busy !== null}>
          Back
        </Button>
        <Button variant="primary" onClick={onContinue} disabled={busy !== null}>
          {busy === 'save' ? 'Saving...' : 'Save and continue'}
        </Button>
      </div>
    </div>
  );
}
