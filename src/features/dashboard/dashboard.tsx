'use client';

import { CalendarDays, Plus } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { MetricCardView } from './metric-card';
import { AssessmentCard } from './assessment-card';
import { TrafficChart } from './traffic-chart';
import { PagesTable } from './pages-table';
import { KeywordsTable } from './keywords-table';
import { DiagnosisCard } from './diagnosis-card';
import { ComplaintCard } from './complaint-card';
import { ResponseEditor } from '@/features/responses/response-editor';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';

/**
 * The dashboard layout from the reference screenshot: a dense left column of
 * evidence and a right column carrying the complaint, the diagnosis and the
 * draft response.
 *
 *   >= 1280px  two columns, roughly 60:40
 *   < 1280px   stacked in reading order
 */
export function Dashboard({
  view,
  analysisId,
  selector,
  readOnly = false,
}: {
  view: DashboardViewModel;
  analysisId: string;
  selector?: React.ReactNode;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-ink">Dashboard</h1>
          {/* The client is named here so the page never leaves a reader
              guessing whose figures they are looking at. */}
          <p className="mt-1 text-[13px] text-ink-muted">
            {view.clientName} &middot; SEO performance and lead-generation evidence
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selector}
          {readOnly ? (
            <ButtonLink href="/login" variant="primary">
              <Plus size={15} aria-hidden />
              Try an analysis
            </ButtonLink>
          ) : (
            <ButtonLink href={`/analyses/new?clientId=${view.clientId ?? ''}`} variant="primary">
              <Plus size={15} aria-hidden />
              New Analysis
            </ButtonLink>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-5">
        {/* Left column: the evidence */}
        <div className="flex min-w-0 flex-col gap-4">
          <AssessmentCard view={view} />

          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-4">
            {view.metrics.map((metric) => (
              <MetricCardView key={metric.key} metric={metric} />
            ))}
          </div>

          <TrafficChart view={view} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PagesTable view={view} />
            <KeywordsTable view={view} />
          </div>
        </div>

        {/* Right column: the conversation */}
        <div className="flex min-w-0 flex-col gap-4">
          <ComplaintCard view={view} />
          <DiagnosisCard view={view} />
          {view.response ? (
            <ResponseEditor
              analysisId={analysisId}
              readOnly={readOnly}
              initial={{
                revision: view.response.revision,
                text: view.response.text,
                generatedText: view.response.generatedText,
                isEdited: view.response.isEdited,
                label: view.response.label,
              }}
            />
          ) : null}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-3 border-t border-line pt-4 text-[12px] text-ink-muted">
        <CalendarDays size={14} aria-hidden />
        {/* Real source and period dates, never a hardcoded "today". */}
        <span>
          Report period {view.footer.reportPeriod}. {view.footer.sourceFreshness}.
        </span>
        {view.footer.isHistorical ? (
          <Badge tone="caution">Historical report</Badge>
        ) : null}
        {view.footer.trackingStatus !== 'verified' ? (
          <Badge tone="caution">Tracking {view.footer.trackingStatus.replace('_', ' ')}</Badge>
        ) : null}
      </footer>
    </div>
  );
}
