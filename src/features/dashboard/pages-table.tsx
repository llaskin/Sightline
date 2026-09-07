'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { Card, CardHeader, EmptyState, NotProvided } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/drawer';
import { formatCount, formatWholePercent, NOT_PROVIDED } from '@/lib/format';

/** Top landing pages by current sessions, always labelled as a subset. */
export function PagesTable({ view }: { view: DashboardViewModel }) {
  const { pages } = view;
  const [sortDescending, setSortDescending] = useState(true);

  const sorted = [...pages.allRows].sort((a, b) =>
    sortDescending ? (b.sessions ?? -1) - (a.sessions ?? -1) : (a.sessions ?? -1) - (b.sessions ?? -1),
  );

  return (
    <Card className="flex flex-col">
      <CardHeader id="pages-heading" title="Top Performing Pages" />
      {pages.allRows.length === 0 ? (
        <EmptyState
          title="No landing-page data"
          description="This report did not include a landing-pages file, so there is nothing to list here."
        />
      ) : (
        <>
          <div className="overflow-x-auto px-4">
            <Table rows={pages.rows} caption={pages.caption} />
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-[11px] leading-relaxed text-ink-faint">
              A labelled subset of the supplied pages, not all site traffic.
            </p>
            <Drawer
              title="All landing pages"
              description={pages.caption}
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
              <button
                type="button"
                onClick={() => setSortDescending((value) => !value)}
                className="mb-3 min-h-[38px] rounded-[10px] border border-line-strong px-3 text-[12px] text-ink-muted hover:text-ink"
              >
                Sort by current sessions: {sortDescending ? 'highest first' : 'lowest first'}
              </button>
              <div className="overflow-x-auto">
                <Table rows={sorted} caption={pages.caption} showBaseline />
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
  showBaseline = false,
}: {
  rows: DashboardViewModel['pages']['allRows'];
  caption: string;
  showBaseline?: boolean;
}) {
  return (
    <table className="w-full min-w-[300px] border-collapse text-left text-[12px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-ink-faint">
          <th scope="col" className="py-2 pr-3 font-medium">Page</th>
          {showBaseline ? (
            <th scope="col" className="py-2 pr-3 text-right font-medium">Baseline</th>
          ) : null}
          <th scope="col" className="py-2 pr-3 text-right font-medium">Sessions</th>
          <th scope="col" className="py-2 text-right font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path} className="border-b border-line/60 last:border-0">
            <td className="py-2 pr-3 text-ink">{row.path}</td>
            {showBaseline ? (
              <td className="py-2 pr-3 text-right text-ink-muted">
                {row.baselineSessions === null ? <NotProvided /> : formatCount(row.baselineSessions)}
              </td>
            ) : null}
            <td className="py-2 pr-3 text-right text-ink">
              {row.sessions === null ? <NotProvided /> : formatCount(row.sessions)}
            </td>
            <td className="py-2 text-right">
              {row.change === null ? (
                <NotProvided>{NOT_PROVIDED}</NotProvided>
              ) : (
                <span className={row.change >= 0 ? 'text-positive' : 'text-negative'}>
                  {formatWholePercent(row.change)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
