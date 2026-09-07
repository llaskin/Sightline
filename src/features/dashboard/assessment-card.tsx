'use client';

import { Info } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { Card, CardHeader, Badge } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/drawer';

/**
 * Replaces the screenshot's "Overall Excuse Validity" gauge.
 *
 * The screenshot showed a needle at 82% labelled "Not an SEO Problem". No such
 * number can be derived from two reporting periods, so this card shows what can
 * actually be supported: whether the stated outcome could be checked, and which
 * of four areas the evidence points at. There is no percentage anywhere.
 */

const STATUS_TONE = {
  supported: 'caution',
  contradicted: 'neutral',
  unverified: 'neutral',
} as const;

export function AssessmentCard({ view }: { view: DashboardViewModel }) {
  const { assessment } = view;

  return (
    <Card className="p-4">
      <CardHeader
        id="assessment-heading"
        title="Complaint assessment"
        action={
          <Drawer
            title="How this is decided"
            description="These are product heuristics for deciding where to look, not statistical significance tests."
            trigger={
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-faint hover:text-ink"
              >
                <Info size={15} aria-hidden />
                <span className="sr-only">How the assessment is decided</span>
              </button>
            }
          >
            <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-muted">
              <p>
                The assessment answers one question only: does direct evidence confirm the specific
                outcome the client described? It is a literal comparison of the supplied figures.
              </p>
              <p>
                The investigation focus is a separate judgement about where to look. It applies
                movement thresholds, so a small change can support the complaint while the focus
                still reports no clear issue. Neither is a probability.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {assessment.strengthReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </Drawer>
        }
      />

      <div className="flex flex-col gap-5 px-4 pb-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-semibold leading-tight text-ink">
            {assessment.statusLabel}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{assessment.reason}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[assessment.status]}>{assessment.strengthLabel}</Badge>
            {assessment.periodAlignment === 'mismatched' ? (
              <Badge tone="caution">Complaint period differs from the report</Badge>
            ) : null}
          </div>
        </div>

        <FocusIndicator view={view} />
      </div>
    </Card>
  );
}

/**
 * Four labelled segments, one highlighted. Position is chosen by the diagnosis
 * category, never by a score, so there is nothing here to read as a percentage.
 */
function FocusIndicator({ view }: { view: DashboardViewModel }) {
  const { assessment } = view;

  const TONE: Record<string, string> = {
    measurement: 'bg-caution',
    search_acquisition: 'bg-chart-a',
    post_click: 'bg-negative',
    mixed_or_unclear: 'bg-ink-faint',
  };

  return (
    <div className="w-full shrink-0 lg:max-w-[300px]">
      <p className="mb-2 text-[12px] font-medium text-ink-muted">Investigation focus</p>
      <ul className="flex flex-col gap-1.5" aria-label="Investigation focus">
        {assessment.focusOptions.map((option) => (
          <li key={option.value} className="flex items-center gap-2.5">
            {/* A shape and a label, so colour is never the only signal. */}
            <span
              aria-hidden
              className={`h-2.5 w-8 shrink-0 rounded-full ${
                option.selected ? TONE[option.value] : 'bg-line-strong'
              }`}
            />
            <span
              className={`text-[13px] ${
                option.selected ? 'font-semibold text-ink' : 'text-ink-faint'
              }`}
            >
              {/* The name and the marker are separate elements so assistive
                  technology reads them as two facts, not one run-on string. */}
              <span>{option.label}</span>
              {option.selected ? (
                <span className="ml-2 text-[11px] font-normal text-ink-muted">selected</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
        {assessment.focusDescription}
      </p>
    </div>
  );
}
