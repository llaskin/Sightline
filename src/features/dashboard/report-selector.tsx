'use client';

import { useRouter } from 'next/navigation';
import { CalendarDays } from 'lucide-react';

/**
 * Switches the entire saved analysis. Navigating replaces every panel at once,
 * so the complaint, evidence and response can never describe different
 * analyses.
 */
export function AnalysisSelector({
  analyses,
  currentId,
}: {
  analyses: Array<{ id: string; label: string }>;
  currentId: string;
}) {
  const router = useRouter();
  if (analyses.length === 0) return null;

  return (
    <div className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-strong bg-surface-raised px-3">
      <CalendarDays size={15} aria-hidden className="text-ink-faint" />
      <label htmlFor="analysis-selector" className="sr-only">
        Choose a saved analysis
      </label>
      <select
        id="analysis-selector"
        value={currentId}
        onChange={(event) => router.push(`/analyses/${event.target.value}`)}
        className="min-h-[42px] bg-transparent pr-1 text-[13px] text-ink focus:outline-none"
      >
        {analyses.map((analysis) => (
          <option key={analysis.id} value={analysis.id}>
            {analysis.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ClientSelector({
  clients,
  currentId,
}: {
  clients: Array<{ id: string; name: string }>;
  currentId: string | null;
}) {
  const router = useRouter();
  return (
    <div className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-strong bg-surface-raised px-3">
      <label htmlFor="client-selector" className="sr-only">
        Choose a client
      </label>
      <select
        id="client-selector"
        value={currentId ?? ''}
        onChange={(event) => router.push(`/dashboard?clientId=${event.target.value}`)}
        className="min-h-[42px] bg-transparent pr-1 text-[13px] text-ink focus:outline-none"
      >
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </div>
  );
}
