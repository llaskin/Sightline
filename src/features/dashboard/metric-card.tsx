'use client';

import { TrendingUp, Trophy, Target, AlertTriangle, Info } from 'lucide-react';
import type { MetricCard as MetricCardModel } from './view-model';
import { Card, Tone } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/drawer';

/**
 * One metric card. Every string shown here already came formatted from the view
 * model; nothing is calculated in this component.
 */

const ICONS = {
  traffic: TrendingUp,
  keywords: Trophy,
  conversion: Target,
  formErrors: AlertTriangle,
} as const;

export function MetricCardView({ metric }: { metric: MetricCardModel }) {
  const Icon = ICONS[metric.key];

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-1">
        <h3 className="flex min-h-[34px] min-w-0 items-start gap-1.5 text-[12.5px] font-medium leading-[1.25] text-ink-muted">
          <Icon size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-faint" />
          <span>{metric.title}</span>
        </h3>
        <Drawer
          title={metric.title}
          description={metric.drawer.canInformComplaint}
          trigger={
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-faint hover:text-ink"
            >
              <Info size={15} aria-hidden />
              <span className="sr-only">Show the evidence behind {metric.title}</span>
            </button>
          }
        >
          <MetricDrawerBody metric={metric} />
        </Drawer>
      </div>

      <p className="text-[28px] font-semibold leading-none">
        <Tone tone={metric.tone}>{metric.value}</Tone>
      </p>
      <p className="text-[12px] text-ink-muted">{metric.detail}</p>

      {/*
        No sparkline is drawn. Two summary values cannot describe a shape, and
        inventing one would be the most convincing possible lie on this card.
      */}
      {!metric.eligible ? (
        <p className="text-[11px] leading-relaxed text-caution">
          Shown for reference; not comparable enough to carry a direction.
        </p>
      ) : null}
    </Card>
  );
}

function MetricDrawerBody({ metric }: { metric: MetricCardModel }) {
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <section>
        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Formula
        </h3>
        <p className="font-mono text-[12px] leading-relaxed text-ink">{metric.drawer.formula}</p>
      </section>

      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Values
        </h3>
        <dl className="divide-y divide-line rounded-[10px] border border-line">
          {metric.drawer.rows.map((row) => (
            <div key={row.label} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <dt className="text-ink-muted">{row.label}</dt>
              <dd className="text-right text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Source
        </h3>
        <ul className="space-y-1 text-ink-muted">
          {metric.drawer.sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
        <p className="mt-2 text-ink-muted">Retrieved: {metric.drawer.retrievedAt}</p>
        <p className="text-ink-muted">Coverage: {metric.drawer.coverage}</p>
      </section>

      <section>
        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          What this can and cannot tell you
        </h3>
        <p className="leading-relaxed text-ink-muted">{metric.drawer.canInformComplaint}</p>
      </section>

      {metric.drawer.caveats.length > 0 ? (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-caution">
            Caveats
          </h3>
          <ul className="list-disc space-y-1 pl-5 leading-relaxed text-ink-muted">
            {metric.drawer.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
