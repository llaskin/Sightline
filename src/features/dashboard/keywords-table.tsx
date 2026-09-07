'use client';

import { ArrowRight } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { Card, CardHeader, EmptyState, NotProvided } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/drawer';
import { formatSignedInteger } from '@/lib/format';

/**
 * Keyword movement within the matched cohort. An unranked end shows a text
 * label rather than a fabricated position such as 100.
 */
export function KeywordsTable({ view }: { view: DashboardViewModel }) {
  const { keywords } = view;

  return (
    <Card className="flex flex-col">
      <CardHeader id="keywords-heading" title="Top Keywords Movement" />
      {keywords.allRows.length === 0 ? (
        <EmptyState
          title="No keyword data"
          description="This report did not include a keywords file, so ranking movement cannot be shown."
        />
      ) : (
        <>
          <div
            className="overflow-x-auto px-4"
            tabIndex={0}
            role="region"
            aria-label="Top keyword movement"
          >
            <Table rows={keywords.rows} caption={keywords.caption} />
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-[11px] leading-relaxed text-ink-faint">
              The five largest improvements in the matched cohort.
            </p>
            <Drawer
              title="Full keyword cohort"
              description={keywords.caption}
              trigger={
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] text-[12px] text-[#a99bff] hover:text-white"
                >
                  View full report
                  <ArrowRight size={13} aria-hidden />
                </button>
              }
            >
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Full keyword cohort"
              >
                <Table rows={keywords.allRows} caption={keywords.caption} />
              </div>
            </Drawer>
          </div>
        </>
      )}
    </Card>
  );
}

function Table({
  rows,
  caption,
}: {
  rows: DashboardViewModel['keywords']['allRows'];
  caption: string;
}) {
  return (
    <table className="w-full min-w-[320px] border-collapse text-left text-[12px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-ink-faint">
          <th scope="col" className="py-2 pr-3 font-medium">Keyword</th>
          <th scope="col" className="py-2 pr-2 text-right font-medium">Old</th>
          <th scope="col" className="py-2 pr-2 text-right font-medium">New</th>
          <th scope="col" className="py-2 text-right font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.keyword} className="border-b border-line/60 last:border-0">
            <td className="py-2 pr-3 text-ink">{row.keyword}</td>
            <td className="py-2 pr-3 text-right text-ink-muted">
              {row.baselinePosition ?? <NotProvided>Unranked</NotProvided>}
            </td>
            <td className="py-2 pr-3 text-right text-ink-muted">
              {row.currentPosition ?? <NotProvided>Unranked</NotProvided>}
            </td>
            <td className="py-2 text-right">
              {row.movement === null ? (
                <span className="text-ink-faint">{row.movementLabel}</span>
              ) : (
                <span className={row.movement >= 0 ? 'text-positive' : 'text-negative'}>
                  {formatSignedInteger(row.movement)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
