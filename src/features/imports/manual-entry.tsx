'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField, SelectField, TextAreaField } from '@/components/ui/fields';

/**
 * Manual entry.
 *
 * Every control here writes the same canonical camelCase rows that a CSV upload
 * produces, so a number typed by hand and the same number in a file normalise
 * to one value. snake_case exists only inside the CSV files themselves.
 *
 * A blank numeric cell becomes `null`, which means unknown. It is never turned
 * into a zero, and a value that is not a plain whole number is passed through
 * unchanged so validation names it rather than silently coercing it.
 */

export type PeriodKey = 'baseline' | 'current';

export type SourceValue = {
  sourceKind: string;
  sourceLabel: string;
  exportedAt: string;
  coverage: string;
  scopeKey: string;
  definitionVersion: string;
  timeZone: string | null;
  acknowledgedTimeZoneDifference: boolean;
  evidenceNote: string | null;
};

export type PeriodSourcesValue = { baseline: SourceValue; current: SourceValue };

export const SOURCE_KINDS = [
  { value: 'ga4_export', label: 'Analytics export' },
  { value: 'gsc', label: 'Search Console' },
  { value: 'rank_tracker', label: 'Rank tracker' },
  { value: 'form_backend', label: 'Form backend' },
  { value: 'crm', label: 'CRM' },
  { value: 'manual', label: 'Manual entry' },
];

export const COVERAGE_OPTIONS = [
  { value: 'complete', label: 'Complete' },
  { value: 'partial', label: 'Partial' },
  { value: 'unknown', label: 'Unknown' },
];

export const SCOPE_OPTIONS = [
  { value: 'organic_search', label: 'Organic search' },
  { value: 'all_channels', label: 'All channels' },
];

export function blankSource(sourceKind = 'manual'): SourceValue {
  return {
    sourceKind,
    sourceLabel: '',
    exportedAt: '',
    coverage: 'complete',
    scopeKey: '',
    definitionVersion: '',
    timeZone: null,
    acknowledgedTimeZoneDifference: false,
    evidenceNote: null,
  };
}

export function blankPeriodSources(sourceKind = 'manual'): PeriodSourcesValue {
  return { baseline: blankSource(sourceKind), current: blankSource(sourceKind) };
}

/**
 * A whole number, `null` for an unknown, or the raw text when it is neither, so
 * an unreadable entry reaches validation instead of being guessed at.
 */
function toCount(raw: string): number | string | null {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d+$/.test(text)) return text;
  return Number(text);
}

/** A `datetime-local` value is local wall-clock time; the payload stores UTC. */
export function localInputToInstant(raw: string): string {
  if (raw.trim() === '') return '';
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

export function instantToLocalInput(iso: string): string {
  const parsed = new Date(iso);
  if (!iso || !Number.isFinite(parsed.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[13px] font-semibold text-ink">{children}</h4>;
}

/** Provenance for one dataset in one period. Six stated facts, none inferred. */
function SourceEditor({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: SourceValue;
  onChange: (next: SourceValue) => void;
}) {
  const set = <K extends keyof SourceValue>(key: K, next: SourceValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset className="rounded-[10px] border border-line p-3">
      <legend className="px-1 text-[12px] font-medium text-ink-muted">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Source kind"
          value={value.sourceKind}
          options={SOURCE_KINDS}
          onChange={(event) => set('sourceKind', event.target.value)}
        />
        <TextField
          label="Source label"
          hint="The export or tool this came from, named as a person would recognise it."
          value={value.sourceLabel}
          onChange={(event) => set('sourceLabel', event.target.value)}
        />
        <TextField
          label="Exported at"
          type="datetime-local"
          hint="When the data was pulled, in your local time. Stored as UTC."
          value={instantToLocalInput(value.exportedAt)}
          onChange={(event) => set('exportedAt', localInputToInstant(event.target.value))}
        />
        <SelectField
          label="Coverage"
          hint="Whether this export covers the whole window."
          value={value.coverage}
          options={COVERAGE_OPTIONS}
          onChange={(event) => set('coverage', event.target.value)}
        />
        <TextField
          label="Scope key"
          hint="The filters applied, for example property=1;channel=organic_search;country=US"
          value={value.scopeKey}
          onChange={(event) => set('scopeKey', event.target.value)}
        />
        <TextField
          label="Definition version"
          hint="Which version of the counting definition produced these numbers."
          value={value.definitionVersion}
          onChange={(event) => set('definitionVersion', event.target.value)}
        />
        <TextField
          label="Source time zone"
          hint="Optional. Kept verbatim and never relabelled to the report zone."
          value={value.timeZone ?? ''}
          onChange={(event) =>
            set('timeZone', event.target.value.trim() === '' ? null : event.target.value)
          }
        />
        <TextAreaField
          label="Evidence note"
          hint="Required for manual entry: where the number came from and who checked it."
          value={value.evidenceNote ?? ''}
          onChange={(event) =>
            set('evidenceNote', event.target.value.trim() === '' ? null : event.target.value)
          }
        />
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-ink-muted">
        <input
          type="checkbox"
          checked={value.acknowledgedTimeZoneDifference}
          onChange={(event) => set('acknowledgedTimeZoneDifference', event.target.checked)}
          className="h-4 w-4"
        />
        I have noted that this source uses a different time zone from the report
      </label>
    </fieldset>
  );
}

/** Provenance for one dataset across both periods. */
export function DatasetProvenance({
  title,
  value,
  onChange,
}: {
  title: string;
  value: PeriodSourcesValue;
  onChange: (next: PeriodSourcesValue) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>{title} provenance</SectionTitle>
      <div className="grid gap-3 xl:grid-cols-2">
        <SourceEditor
          legend="Baseline period"
          value={value.baseline}
          onChange={(next) => onChange({ ...value, baseline: next })}
        />
        <SourceEditor
          legend="Current period"
          value={value.current}
          onChange={(next) => onChange({ ...value, current: next })}
        />
      </div>
    </div>
  );
}

type OrganicStrings = Record<PeriodKey, { sessions: string; activeUsers: string; leadSessions: string }>;

function seedOrganic(rows: unknown[] | null | undefined): OrganicStrings {
  const read = (period: PeriodKey) => {
    const row = (rows ?? []).find(
      (candidate) => (candidate as { period?: string })?.period === period,
    ) as { sessions?: unknown; activeUsers?: unknown; leadSessions?: unknown } | undefined;
    const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
    return {
      sessions: text(row?.sessions),
      activeUsers: text(row?.activeUsers),
      leadSessions: text(row?.leadSessions),
    };
  };
  return { baseline: read('baseline'), current: read('current') };
}

/**
 * The organic summary, which is the one dataset every report must carry. It is
 * offered here as well as by file so a report can be built without an export.
 */
export function OrganicManualEntry({
  rows,
  onChange,
}: {
  rows: unknown[] | null | undefined;
  onChange: (rows: unknown[]) => void;
}) {
  const [values, setValues] = useState<OrganicStrings>(() => seedOrganic(rows));

  function update(period: PeriodKey, field: keyof OrganicStrings['baseline'], raw: string) {
    const next: OrganicStrings = { ...values, [period]: { ...values[period], [field]: raw } };
    setValues(next);
    onChange(
      (['baseline', 'current'] as PeriodKey[]).map((key) => ({
        period: key,
        sessions: toCount(next[key].sessions),
        activeUsers: toCount(next[key].activeUsers),
        leadSessions: toCount(next[key].leadSessions),
      })),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Organic summary by hand</SectionTitle>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        Sessions are required. Active users and lead sessions may be left blank, which records them
        as unknown. A blank never becomes a zero, and lead sessions can never exceed sessions.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['baseline', 'current'] as PeriodKey[]).map((period) => (
          <fieldset key={period} className="rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[12px] font-medium text-ink-muted capitalize">
              {period} period
            </legend>
            <div className="flex flex-col gap-3">
              <TextField
                label="Sessions"
                inputMode="numeric"
                value={values[period].sessions}
                onChange={(event) => update(period, 'sessions', event.target.value)}
              />
              <TextField
                label="Active users"
                inputMode="numeric"
                hint="An aggregate unique total for this exact window, never a sum of daily figures."
                value={values[period].activeUsers}
                onChange={(event) => update(period, 'activeUsers', event.target.value)}
              />
              <TextField
                label="Lead sessions"
                inputMode="numeric"
                hint="Sessions containing the lead action. Not an event count and not received leads."
                value={values[period].leadSessions}
                onChange={(event) => update(period, 'leadSessions', event.target.value)}
              />
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

type FormStrings = {
  period: PeriodKey;
  formId: string;
  scope: string;
  attempts: string;
  failedAttempts: string;
  errorEvents: string;
};

function seedForms(rows: unknown[] | null | undefined): FormStrings[] {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  return (rows ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      period: (record.period === 'current' ? 'current' : 'baseline') as PeriodKey,
      formId: text(record.formId),
      scope: typeof record.scope === 'string' ? record.scope : 'organic_search',
      attempts: text(record.attempts),
      failedAttempts: text(record.failedAttempts),
      errorEvents: text(record.errorEvents),
    };
  });
}

/** Form attempts and failures, which a traffic export cannot supply. */
export function FormsManualEntry({
  rows,
  onChange,
}: {
  rows: unknown[] | null | undefined;
  onChange: (rows: unknown[] | null) => void;
}) {
  const [values, setValues] = useState<FormStrings[]>(() => seedForms(rows));

  function publish(next: FormStrings[]) {
    setValues(next);
    onChange(
      next.length === 0
        ? null
        : next.map((row) => ({
            period: row.period,
            formId: row.formId,
            scope: row.scope,
            attempts: toCount(row.attempts),
            failedAttempts: toCount(row.failedAttempts),
            errorEvents: toCount(row.errorEvents),
          })),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Form counts by hand</SectionTitle>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        Attempts and failed attempts are unique logical attempts from one instrumentation source.
        Error events may fire several times for a single attempt, so they are counted separately and
        are never used as a rate numerator. Supply the same form and scope in both periods.
      </p>

      {values.map((row, index) => (
        <fieldset key={index} className="rounded-[10px] border border-line p-3">
          <legend className="px-1 text-[12px] font-medium text-ink-muted">Row {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Period"
              value={row.period}
              options={[
                { value: 'baseline', label: 'Baseline' },
                { value: 'current', label: 'Current' },
              ]}
              onChange={(event) => {
                const next = [...values];
                next[index] = { ...row, period: event.target.value as PeriodKey };
                publish(next);
              }}
            />
            <TextField
              label="Form ID"
              value={row.formId}
              onChange={(event) => {
                const next = [...values];
                next[index] = { ...row, formId: event.target.value };
                publish(next);
              }}
            />
            <SelectField
              label="Scope"
              value={row.scope}
              options={SCOPE_OPTIONS}
              onChange={(event) => {
                const next = [...values];
                next[index] = { ...row, scope: event.target.value };
                publish(next);
              }}
            />
            <TextField
              label="Attempts"
              inputMode="numeric"
              value={row.attempts}
              onChange={(event) => {
                const next = [...values];
                next[index] = { ...row, attempts: event.target.value };
                publish(next);
              }}
            />
            <TextField
              label="Failed attempts"
              inputMode="numeric"
              value={row.failedAttempts}
              onChange={(event) => {
                const next = [...values];
                next[index] = { ...row, failedAttempts: event.target.value };
                publish(next);
              }}
            />
            <TextField
              label="Error events"
              inputMode="numeric"
              value={row.errorEvents}
              onChange={(event) => {
                const next = [...values];
                next[index] = { ...row, errorEvents: event.target.value };
                publish(next);
              }}
            />
          </div>
          <div className="mt-3">
            <Button
              type="button"
              variant="danger"
              onClick={() => publish(values.filter((_, position) => position !== index))}
            >
              <Trash2 size={14} aria-hidden />
              Remove row
            </Button>
          </div>
        </fieldset>
      ))}

      <div>
        <Button
          type="button"
          onClick={() =>
            publish([
              ...values,
              {
                period: values.length % 2 === 0 ? 'baseline' : 'current',
                formId: '',
                scope: 'organic_search',
                attempts: '',
                failedAttempts: '',
                errorEvents: '',
              },
            ])
          }
        >
          <Plus size={14} aria-hidden />
          Add a form row
        </Button>
      </div>
    </div>
  );
}

type OutcomeStrings = {
  metric: string;
  baselineValue: string;
  currentValue: string;
  scope: string;
  currency: string;
  sourceKind: string;
  sourceLabel: string;
  definitionVersion: string;
  coverage: string;
  attributionNote: string;
};

const OUTCOME_METRICS = [
  { value: 'received_leads', label: 'Received leads' },
  { value: 'qualified_leads', label: 'Qualified leads' },
  { value: 'revenue', label: 'Revenue (minor units)' },
];

function seedOutcomes(rows: unknown[] | null | undefined): OutcomeStrings[] {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  return (rows ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      metric: text(record.metric) || 'received_leads',
      baselineValue: text(record.baselineValue),
      currentValue: text(record.currentValue),
      scope: typeof record.scope === 'string' ? record.scope : 'organic_search',
      currency: text(record.currency),
      sourceKind: typeof record.sourceKind === 'string' ? record.sourceKind : 'crm',
      sourceLabel: text(record.sourceLabel),
      definitionVersion: text(record.definitionVersion),
      coverage: typeof record.coverage === 'string' ? record.coverage : 'complete',
      attributionNote: text(record.attributionNote),
    };
  });
}

/**
 * Business outcomes are entered here rather than uploaded, because each number
 * needs an attribution note and a definition version beside it. An explicitly
 * supplied zero is meaningful: it is what turns "we got no leads" from
 * unverified into supported.
 */
export function OutcomesManualEntry({
  rows,
  onChange,
}: {
  rows: unknown[] | null | undefined;
  onChange: (rows: unknown[] | null) => void;
}) {
  const [values, setValues] = useState<OutcomeStrings[]>(() => seedOutcomes(rows));

  function publish(next: OutcomeStrings[]) {
    setValues(next);
    onChange(
      next.length === 0
        ? null
        : next.map((row) => ({
            metric: row.metric,
            baselineValue: toCount(row.baselineValue),
            currentValue: toCount(row.currentValue),
            scope: row.scope,
            currency: row.currency.trim() === '' ? null : row.currency.trim().toUpperCase(),
            sourceKind: row.sourceKind,
            sourceLabel: row.sourceLabel,
            definitionVersion: row.definitionVersion,
            coverage: row.coverage,
            attributionNote: row.attributionNote,
          })),
    );
  }

  function edit(index: number, patch: Partial<OutcomeStrings>) {
    const next = [...values];
    next[index] = { ...next[index], ...patch };
    publish(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Business outcomes by hand</SectionTitle>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        Received leads, qualified leads and revenue never come from a traffic report. Enter zero
        where zero is what happened, and leave a field blank only when the number is genuinely
        unknown. Qualified leads can never exceed received leads for the same period and scope.
      </p>

      {values.map((row, index) => (
        <fieldset key={index} className="rounded-[10px] border border-line p-3">
          <legend className="px-1 text-[12px] font-medium text-ink-muted">
            Outcome {index + 1}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Metric"
              value={row.metric}
              options={OUTCOME_METRICS}
              onChange={(event) => edit(index, { metric: event.target.value })}
            />
            <SelectField
              label="Scope"
              value={row.scope}
              options={SCOPE_OPTIONS}
              onChange={(event) => edit(index, { scope: event.target.value })}
            />
            <TextField
              label="Baseline value"
              inputMode="numeric"
              value={row.baselineValue}
              onChange={(event) => edit(index, { baselineValue: event.target.value })}
            />
            <TextField
              label="Current value"
              inputMode="numeric"
              value={row.currentValue}
              onChange={(event) => edit(index, { currentValue: event.target.value })}
            />
            <TextField
              label="Currency"
              hint="Three letters, required for revenue only. Revenue is in minor units."
              value={row.currency}
              onChange={(event) => edit(index, { currency: event.target.value })}
            />
            <SelectField
              label="Source kind"
              value={row.sourceKind}
              options={SOURCE_KINDS}
              onChange={(event) => edit(index, { sourceKind: event.target.value })}
            />
            <TextField
              label="Source label"
              value={row.sourceLabel}
              onChange={(event) => edit(index, { sourceLabel: event.target.value })}
            />
            <TextField
              label="Definition version"
              value={row.definitionVersion}
              onChange={(event) => edit(index, { definitionVersion: event.target.value })}
            />
            <SelectField
              label="Coverage"
              value={row.coverage}
              options={COVERAGE_OPTIONS}
              onChange={(event) => edit(index, { coverage: event.target.value })}
            />
            <TextAreaField
              label="Attribution note"
              hint="How these were attributed to organic search, in the client's own terms."
              value={row.attributionNote}
              onChange={(event) => edit(index, { attributionNote: event.target.value })}
            />
          </div>
          <div className="mt-3">
            <Button
              type="button"
              variant="danger"
              onClick={() => publish(values.filter((_, position) => position !== index))}
            >
              <Trash2 size={14} aria-hidden />
              Remove outcome
            </Button>
          </div>
        </fieldset>
      ))}

      <div>
        <Button
          type="button"
          onClick={() =>
            publish([
              ...values,
              {
                metric: 'received_leads',
                baselineValue: '',
                currentValue: '',
                scope: 'organic_search',
                currency: '',
                sourceKind: 'crm',
                sourceLabel: '',
                definitionVersion: '',
                coverage: 'complete',
                attributionNote: '',
              },
            ])
          }
        >
          <Plus size={14} aria-hidden />
          Add an outcome
        </Button>
      </div>
    </div>
  );
}
