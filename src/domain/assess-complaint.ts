import type { Assessment } from './analysis-schema';
import type { ComplaintInput } from './complaint-schema';
import type { NormalizedReport, OutcomeRow } from './report-schema';
import type { ComparabilityResult } from './comparability';
import type { Signals } from './signals';

/**
 * Outcome assessment (specification section 7.4). This answers only "is the
 * measurable claim supported by direct evidence", which is a separate question
 * from "where should we investigate".
 *
 * Outcome comparisons are literal: any decline supports a "went down" claim.
 * Diagnosis thresholds deliberately filter small movements, so a small decline
 * can support the outcome while the diagnosis stays `no_clear_issue`. That is
 * not a contradiction and it is explained in the reason text.
 */

export type ComplaintAssessment = {
  assessment: Assessment;
  reason: string;
  periodAlignment: 'aligned' | 'mismatched';
};

function findOutcome(
  report: NormalizedReport,
  metric: OutcomeRow['metric'],
  scope: OutcomeRow['scope'],
): OutcomeRow | null {
  return (
    report.datasets.outcomes?.find((row) => row.metric === metric && row.scope === scope) ?? null
  );
}

/** An outcome can only be claimed when its own source coverage is complete. */
function outcomeUsable(report: NormalizedReport, row: OutcomeRow | null): row is OutcomeRow {
  if (!row) return false;
  if (row.coverage !== 'complete') return false;
  const sources = report.sources.outcomes;
  if (!sources) return false;
  return sources.baseline.coverage === 'complete' && sources.current.coverage === 'complete';
}

const THRESHOLD_NOTE =
  'This is a literal comparison of the supplied counts. The diagnosis applies a movement threshold, so a small change can support the complaint while the diagnosis reports no clear issue.';

export function assessComplaint(
  report: NormalizedReport,
  complaint: ComplaintInput,
  quality: ComparabilityResult,
  signals: Signals,
): ComplaintAssessment {
  const aligned =
    complaint.periodStart === report.metadata.currentStart &&
    complaint.periodEnd === report.metadata.currentEnd;
  const periodAlignment = aligned ? 'aligned' : 'mismatched';

  if (!aligned) {
    return {
      assessment: 'unverified',
      periodAlignment,
      reason:
        `The complaint covers ${complaint.periodStart} to ${complaint.periodEnd}, but this report's ` +
        `current period is ${report.metadata.currentStart} to ${report.metadata.currentEnd}. ` +
        'An outcome cannot be assessed across a different period, so the findings below describe the report dates only.',
    };
  }

  switch (complaint.category) {
    case 'no_leads':
    case 'leads_down': {
      const received = findOutcome(report, 'received_leads', complaint.scope);
      if (!outcomeUsable(report, received)) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason:
            'No complete record of received leads was supplied for this period. Sessions containing a lead action are not the same as leads that reached the inbox or CRM, so this claim cannot be checked from the analytics evidence alone.',
        };
      }
      if (complaint.category === 'no_leads') {
        if (received.currentValue === null) {
          return {
            assessment: 'unverified',
            periodAlignment,
            reason: 'The current received-lead count was left blank, which means unknown rather than zero.',
          };
        }
        return received.currentValue === 0
          ? {
              assessment: 'supported',
              periodAlignment,
              reason: `${received.sourceLabel} records 0 received leads in this period, which matches the complaint.`,
            }
          : {
              assessment: 'contradicted',
              periodAlignment,
              reason: `${received.sourceLabel} records ${received.currentValue} received leads in this period.`,
            };
      }
      if (received.currentValue === null || received.baselineValue === null) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason: 'Both periods need a received-lead count before a decline can be confirmed.',
        };
      }
      return received.currentValue < received.baselineValue
        ? {
            assessment: 'supported',
            periodAlignment,
            reason: `${received.sourceLabel} records ${received.currentValue} received leads against ${received.baselineValue} in the baseline period. ${THRESHOLD_NOTE}`,
          }
        : {
            assessment: 'contradicted',
            periodAlignment,
            reason: `${received.sourceLabel} records ${received.currentValue} received leads against ${received.baselineValue} in the baseline period.`,
          };
    }

    case 'traffic_down': {
      if (complaint.scope === 'all_channels') {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason:
            'The complaint concerns all channels, but this report covers organic search only. All-channel traffic evidence is needed before that claim can be checked.',
        };
      }
      if (quality.measurementIssue) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason:
            'The analytics source this claim depends on has a known measurement problem, so its session counts cannot settle the question yet.',
        };
      }
      const baseline = report.datasets.organic.find((row) => row.period === 'baseline')!;
      const current = report.datasets.organic.find((row) => row.period === 'current')!;
      return current.sessions < baseline.sessions
        ? {
            assessment: 'supported',
            periodAlignment,
            reason: `Organic sessions fell from ${baseline.sessions} to ${current.sessions}. ${THRESHOLD_NOTE}`,
          }
        : {
            assessment: 'contradicted',
            periodAlignment,
            reason: `Organic sessions moved from ${baseline.sessions} to ${current.sessions}, which is not a decline.`,
          };
    }

    case 'rankings_down': {
      if (!signals.rank.eligible || signals.rank.values.netTop10Change === null) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason:
            'No eligible fixed tracked-keyword cohort was available. Search Console reports average observed position over an incomplete set of queries, so it cannot settle a fixed-ranking claim.',
        };
      }
      const net = signals.rank.values.netTop10Change;
      return net < 0
        ? {
            assessment: 'supported',
            periodAlignment,
            reason: `Within the tracked commercial keyword cohort, the number in the top 10 changed by ${net}. This statement covers that cohort only, not every query the site ranks for.`,
          }
        : {
            assessment: 'contradicted',
            periodAlignment,
            reason: `Within the tracked commercial keyword cohort, the number in the top 10 changed by +${net}. This statement covers that cohort only, not every query the site ranks for.`,
          };
    }

    case 'revenue_down': {
      const revenue = findOutcome(report, 'revenue', complaint.scope);
      if (!outcomeUsable(report, revenue) || revenue.currentValue === null || revenue.baselineValue === null) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason: 'No complete comparable revenue figure was supplied for both periods.',
        };
      }
      return revenue.currentValue < revenue.baselineValue
        ? {
            assessment: 'supported',
            periodAlignment,
            reason: `${revenue.sourceLabel} records lower revenue in this period, on the stated attribution: ${revenue.attributionNote}. ${THRESHOLD_NOTE}`,
          }
        : {
            assessment: 'contradicted',
            periodAlignment,
            reason: `${revenue.sourceLabel} does not record lower revenue in this period, on the stated attribution: ${revenue.attributionNote}.`,
          };
    }

    case 'lead_quality': {
      const received = findOutcome(report, 'received_leads', complaint.scope);
      const qualified = findOutcome(report, 'qualified_leads', complaint.scope);
      if (
        !outcomeUsable(report, received) ||
        !outcomeUsable(report, qualified) ||
        received.baselineValue === null ||
        received.currentValue === null ||
        qualified.baselineValue === null ||
        qualified.currentValue === null
      ) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason: 'A defined qualified-lead and received-lead count is needed in both periods.',
        };
      }
      if (received.baselineValue === 0 || received.currentValue === 0) {
        return {
          assessment: 'unverified',
          periodAlignment,
          reason: 'A qualified-lead rate needs a received-lead count above zero in both periods.',
        };
      }
      const baselineRate = qualified.baselineValue / received.baselineValue;
      const currentRate = qualified.currentValue / received.currentValue;
      return currentRate < baselineRate
        ? {
            assessment: 'supported',
            periodAlignment,
            reason: `The qualified share of received leads fell from ${qualified.baselineValue}/${received.baselineValue} to ${qualified.currentValue}/${received.currentValue}. ${THRESHOLD_NOTE}`,
          }
        : {
            assessment: 'contradicted',
            periodAlignment,
            reason: `The qualified share of received leads moved from ${qualified.baselineValue}/${received.baselineValue} to ${qualified.currentValue}/${received.currentValue}, which is not a decline.`,
          };
    }

    case 'seo_underperforming':
    case 'other':
      return {
        assessment: 'unverified',
        periodAlignment,
        reason:
          'This complaint does not make one specific measurable claim, so there is nothing to confirm or contradict directly. The findings below report what the evidence does and does not show.',
      };
  }
}
