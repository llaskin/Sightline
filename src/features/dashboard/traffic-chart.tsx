'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Info } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/drawer';
import { formatCount } from '@/lib/format';

/**
 * The traffic chart plots only the buckets that were actually supplied.
 *
 * If no trend file was imported there is no line, no interpolation and no
 * guess: the card says so. A missing interval stays a gap rather than being
 * joined across.
 */
export function TrafficChart({ view }: { view: DashboardViewModel }) {
  const { chart } = view;
  const [range, setRange] = useState<'current' | 'last3' | 'last6'>(() => {
    if (chart.series.length >= 6) return 'last6';
    if (chart.series.length >= 3) return 'last3';
    return 'current';
  });
  const [showUsers, setShowUsers] = useState(true);
  const [showSessions, setShowSessions] = useState(true);

  const points = useMemo(() => {
    const take = range === 'last6' ? 6 : range === 'last3' ? 3 : 1;
    return chart.series.slice(-take);
  }, [chart.series, range]);

  return (
    <Card className="flex flex-col">
      <CardHeader
        id="chart-heading"
        title="Organic Traffic Overview"
        action={
          <div className="flex items-center gap-2">
            <Drawer
              title="About this chart"
              trigger={
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-faint hover:text-ink"
                >
                  <Info size={15} aria-hidden />
                  <span className="sr-only">About this chart</span>
                </button>
              }
            >
              <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-muted">
                <p>{chart.usersNote}</p>
                <p>
                  Only buckets present in the imported trend file are plotted. Nothing is
                  interpolated, and a missing interval is left as a gap rather than joined across.
                </p>
                <ChartTable view={view} />
              </div>
            </Drawer>

            <label className="sr-only" htmlFor="chart-range">
              Chart range
            </label>
            <select
              id="chart-range"
              value={range}
              onChange={(event) => setRange(event.target.value as typeof range)}
              className="min-h-[38px] rounded-[10px] border border-line-strong bg-surface-raised px-2.5 text-[12px] text-ink"
            >
              {chart.rangeOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                  {option.disabled ? ' (not supplied)' : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {chart.series.length === 0 ? (
        <EmptyState
          title="Trend data not provided"
          description="This report has no traffic-trend file, so there is no series to plot. A line drawn between two summary totals would describe a shape nobody measured."
        />
      ) : (
        <div className="px-4 pb-4">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <ToggleLegend
              label="Users"
              colour="var(--color-chart-b)"
              checked={showUsers}
              onChange={setShowUsers}
            />
            <ToggleLegend
              label="Sessions"
              colour="var(--color-chart-a)"
              checked={showSessions}
              onChange={setShowSessions}
            />
          </div>

          <div className="h-[240px] w-full" role="img" aria-label={describe(points)}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-line)' }}
                />
                <YAxis
                  tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) =>
                    value >= 1000 ? `${Math.round(value / 1000)}K` : String(value)
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-raised)',
                    border: '1px solid var(--color-line-strong)',
                    borderRadius: 10,
                    fontSize: 12,
                    color: 'var(--color-ink)',
                  }}
                  formatter={(value, name) => [
                    typeof value === 'number' ? formatCount(value) : 'Not provided',
                    String(name),
                  ]}
                />
                {showUsers ? (
                  <Line
                    type="monotone"
                    dataKey="activeUsers"
                    name="Users"
                    stroke="var(--color-chart-b)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    // A null value leaves a gap instead of being bridged.
                    connectNulls={false}
                  />
                ) : null}
                {showSessions ? (
                  <Line
                    type="monotone"
                    dataKey="sessions"
                    name="Sessions"
                    stroke="var(--color-chart-a)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-ink-muted hover:text-ink">
              Show the chart data as a table
            </summary>
            <div className="mt-2">
              <ChartTable view={view} />
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}

function describe(points: Array<{ label: string; sessions: number }>): string {
  if (points.length === 0) return 'No trend data was provided';
  const first = points[0];
  const last = points[points.length - 1];
  return `Organic sessions across ${points.length} supplied periods, from ${first.sessions} in the period ending ${first.label} to ${last.sessions} in the period ending ${last.label}.`;
}

function ToggleLegend({
  label,
  colour,
  checked,
  onChange,
}: {
  label: string;
  colour: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-ink-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[color:var(--color-accent)]"
      />
      <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: colour }} />
      {label}
    </label>
  );
}

/** The accessible equivalent of the line chart. */
export function ChartTable({ view }: { view: DashboardViewModel }) {
  if (view.chart.table.length === 0) {
    return <p className="text-[13px] text-ink-muted">Trend data not provided.</p>;
  }
  return (
    /* A scrollable region must be focusable, or a keyboard-only reader cannot
       scroll it to reach the columns that sit off-screen. */
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Traffic data table">
      <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
        <caption className="sr-only">
          Organic sessions and users for each supplied reporting period
        </caption>
        <thead>
          <tr className="border-b border-line text-ink-faint">
            <th scope="col" className="py-2 pr-3 font-medium">Period</th>
            <th scope="col" className="py-2 pr-3 font-medium">Sessions</th>
            <th scope="col" className="py-2 font-medium">Users</th>
          </tr>
        </thead>
        <tbody>
          {view.chart.table.map((row) => (
            <tr key={row.period} className="border-b border-line/60">
              <td className="py-2 pr-3 text-ink-muted">{row.period}</td>
              <td className="py-2 pr-3 text-ink">{row.sessions}</td>
              <td className="py-2 text-ink">{row.activeUsers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
