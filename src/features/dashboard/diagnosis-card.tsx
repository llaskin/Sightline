'use client';

import { Lightbulb, TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { Card, CardHeader, Badge } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/drawer';

/**
 * Labelled "Evidence diagnosis", not "AI Diagnosis", because release 1
 * generates this from deterministic rules. Calling it AI would misdescribe how
 * it was produced.
 */

const DIRECTION_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
  unknown: HelpCircle,
} as const;

const DIRECTION_TONE = {
  up: 'text-positive',
  down: 'text-negative',
  flat: 'text-ink-muted',
  unknown: 'text-ink-faint',
} as const;

export function DiagnosisCard({ view }: { view: DashboardViewModel }) {
  const { diagnosis } = view;

  return (
    <Card className="p-0">
      <CardHeader
        id="diagnosis-heading"
        title={diagnosis.title}
        icon={<Lightbulb size={16} aria-hidden className="text-caution" />}
        action={<Badge tone="accent">Rule generated</Badge>}
      />

      <ul className="flex flex-col divide-y divide-line/70 border-t border-line">
        {diagnosis.findings.map((finding) => {
          const Icon = DIRECTION_ICON[finding.direction];
          return (
            <li key={finding.id} className="flex items-start gap-3 px-4 py-3">
              <Icon
                size={15}
                aria-hidden
                className={`mt-0.5 shrink-0 ${DIRECTION_TONE[finding.direction]}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-relaxed text-ink">{finding.text}</p>
                {finding.caveats.length > 0 ? (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-caution">
                    {finding.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Drawer
                    title="Evidence for this finding"
                    description={finding.text}
                    trigger={
                      <button
                        type="button"
                        className="min-h-[32px] rounded-[8px] border border-line px-2.5 text-[11px] text-ink-muted hover:text-ink"
                      >
                        Show sources
                      </button>
                    }
                  >
                    <FindingDetail finding={finding} />
                  </Drawer>
                  {!finding.eligible ? (
                    <span className="text-[11px] text-ink-faint">Context only</span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line px-4 py-3">
        <p className="text-[14px] font-semibold leading-relaxed text-ink">{diagnosis.headline}</p>
      </div>

      {diagnosis.gaps.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            What this does not establish
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-ink-muted">
            {diagnosis.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {diagnosis.nextChecks.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Suggested next checks
          </h3>
          <ul className="space-y-2">
            {diagnosis.nextChecks.map((check) => (
              <li key={check.text} className="text-[12px] leading-relaxed text-ink-muted">
                {check.text}
                {/* A function to involve, never a person to blame. */}
                <span className="ml-1.5 whitespace-nowrap text-[11px] text-ink-faint">
                  ({check.functionToInvolve})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function FindingDetail({
  finding,
}: {
  finding: DashboardViewModel['diagnosis']['findings'][number];
}) {
  const entries = Object.entries(finding.values);
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Where this comes from
        </h3>
        <ul className="space-y-1 text-ink-muted">
          {finding.sources.map((source) => (
            <li key={`${source.dataset}-${source.period}-${source.rowKey}`}>
              {source.dataset}
              {source.period ? ` (${source.period})` : ''} &rarr; {source.rowKey}
            </li>
          ))}
        </ul>
      </section>

      {entries.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Unrounded values
          </h3>
          <dl className="divide-y divide-line rounded-[10px] border border-line">
            {entries.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3 px-3 py-2">
                <dt className="font-mono text-[11px] text-ink-muted">{key}</dt>
                <dd className="text-right text-[12px] text-ink">
                  {value === null ? 'Not provided' : value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <p className="text-[12px] leading-relaxed text-ink-faint">
        Rule: <span className="font-mono">{finding.ruleId}</span>. Unit: {finding.unit}.
        {finding.eligible
          ? ' This evidence is eligible to carry a direction.'
          : ' This evidence is shown as context and does not carry a direction.'}
      </p>
    </div>
  );
}
