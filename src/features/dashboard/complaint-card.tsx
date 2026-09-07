import { Quote } from 'lucide-react';
import type { DashboardViewModel } from './view-model';
import { Card, CardHeader, Badge } from '@/components/ui/primitives';

/**
 * The complaint, quoted exactly as the client wrote it.
 *
 * React escapes this text on render, and the analysis engine treats it as data.
 * It is never interpreted as an instruction, however it is phrased.
 */
export function ComplaintCard({ view }: { view: DashboardViewModel }) {
  const { complaint } = view;

  return (
    <Card className="p-0">
      <CardHeader
        id="complaint-heading"
        title="Client Complaint"
        icon={<Quote size={16} aria-hidden className="text-[#a99bff]" />}
      />
      <div className="px-4 pb-4">
        <blockquote className="rounded-[10px] border border-complaint-line bg-complaint px-4 py-3">
          <p className="whitespace-pre-wrap text-[16px] font-medium leading-relaxed text-ink">
            &ldquo;{complaint.originalText}&rdquo;
          </p>
          <footer className="mt-2 text-[11px] text-ink-muted">
            Received {complaint.receivedLabel}
          </footer>
        </blockquote>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge>{complaint.categoryLabel}</Badge>
          <Badge>{complaint.scopeLabel}</Badge>
          <Badge>Complaint period: {complaint.periodLabel}</Badge>
        </div>
      </div>
    </Card>
  );
}
