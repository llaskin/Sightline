import {
  normalizedReportSchema,
  type DatasetSource,
  type KeywordRow,
  type NormalizedReport,
  type OutcomeRow,
  type PeriodSources,
} from '@/domain/report-schema';
import type { ComplaintInput } from '@/domain/complaint-schema';

/**
 * Builds schema-valid reports for analysis scenarios. Every case states only
 * what it varies, so a fixture can never accidentally satisfy a rule through a
 * value the test never mentioned.
 */

export const NOW = new Date('2026-08-11T12:00:00Z');

type Options = {
  baselineSessions?: number;
  currentSessions?: number;
  baselineLeadSessions?: number | null;
  currentLeadSessions?: number | null;
  baselineActiveUsers?: number | null;
  currentActiveUsers?: number | null;
  trackingStatus?: 'verified' | 'unverified' | 'known_issue';
  organicCoverage?: 'complete' | 'partial' | 'unknown';
  organicDefinitionMismatch?: boolean;
  keywords?: KeywordRow[] | null;
  keywordSourceKind?: 'rank_tracker' | 'gsc';
  keywordCoverage?: 'complete' | 'partial' | 'unknown';
  forms?: Array<{
    period: 'baseline' | 'current';
    formId?: string;
    scope?: 'organic_search' | 'all_channels';
    attempts: number | null;
    failedAttempts: number | null;
    errorEvents: number;
  }> | null;
  selectedForm?: { formId: string; scope: 'organic_search' | 'all_channels' } | null;
  formCoverage?: 'complete' | 'partial' | 'unknown';
  outcomes?: OutcomeRow[] | null;
  outcomeCoverage?: 'complete' | 'partial' | 'unknown';
};

function source(overrides: Partial<DatasetSource> & Pick<DatasetSource, 'sourceKind'>): DatasetSource {
  return {
    sourceLabel: 'Fictional export',
    exportedAt: '2026-08-11T12:00:00.000Z',
    coverage: 'complete',
    scopeKey: 'property=test;channel=organic_search',
    definitionVersion: 'v1',
    timeZone: 'America/New_York',
    acknowledgedTimeZoneDifference: false,
    evidenceNote: null,
    ...overrides,
  };
}

function pair(base: DatasetSource): PeriodSources {
  return { baseline: { ...base }, current: { ...base } };
}

export function buildReport(options: Options = {}): NormalizedReport {
  const {
    baselineSessions = 7210,
    currentSessions = 12540,
    baselineLeadSessions = 151,
    currentLeadSessions = 150,
    baselineActiveUsers = 5800,
    currentActiveUsers = 10150,
    trackingStatus = 'verified',
    organicCoverage = 'complete',
    organicDefinitionMismatch = false,
    keywords = null,
    keywordSourceKind = 'rank_tracker',
    keywordCoverage = 'complete',
    forms = null,
    selectedForm = forms ? { formId: 'contact', scope: 'organic_search' as const } : null,
    formCoverage = 'complete',
    outcomes = null,
    outcomeCoverage = 'complete',
  } = options;

  const analytics = pair(source({ sourceKind: 'ga4_export' }));
  analytics.baseline.coverage = organicCoverage;
  analytics.current.coverage = organicCoverage;
  if (organicDefinitionMismatch) analytics.current.definitionVersion = 'v2';

  const candidate = {
    schemaVersion: 1 as const,
    metadata: {
      reportLabel: 'Test report',
      currentStart: '2026-07-12',
      currentEnd: '2026-08-10',
      baselineStart: '2026-06-12',
      baselineEnd: '2026-07-11',
      timeZone: 'America/New_York',
      channel: 'organic_search' as const,
      propertyLabel: 'Test client — example.com',
      leadDefinition: 'Sessions containing the lead key event',
      leadEventName: 'generate_lead',
      trackingStatus,
      trackingEvidenceNote: 'Fictional test evidence.',
      trackingReviewedAt: '2026-08-11T10:00:00.000Z',
      trackingReviewedBy: 'Test Analyst',
    },
    datasets: {
      organic: [
        {
          period: 'baseline' as const,
          sessions: baselineSessions,
          activeUsers: baselineActiveUsers,
          leadSessions: baselineLeadSessions,
        },
        {
          period: 'current' as const,
          sessions: currentSessions,
          activeUsers: currentActiveUsers,
          leadSessions: currentLeadSessions,
        },
      ],
      keywords,
      forms: forms
        ? forms.map((row) => ({
            period: row.period,
            formId: row.formId ?? 'contact',
            scope: row.scope ?? ('organic_search' as const),
            attempts: row.attempts,
            failedAttempts: row.failedAttempts,
            errorEvents: row.errorEvents,
          }))
        : null,
      landingPages: null,
      trafficTrend: null,
      outcomes,
    },
    sources: {
      organic: analytics,
      keywords: keywords
        ? (() => {
            const s = pair(source({ sourceKind: keywordSourceKind, definitionVersion: 'rank-v1' }));
            s.baseline.coverage = keywordCoverage;
            s.current.coverage = keywordCoverage;
            return s;
          })()
        : null,
      forms: forms
        ? (() => {
            const s = pair(source({ sourceKind: 'form_backend', definitionVersion: 'form-v1' }));
            s.baseline.coverage = formCoverage;
            s.current.coverage = formCoverage;
            return s;
          })()
        : null,
      landingPages: null,
      trafficTrend: null,
      outcomes: outcomes
        ? (() => {
            const s = pair(source({ sourceKind: 'crm', definitionVersion: 'crm-v1' }));
            s.baseline.coverage = outcomeCoverage;
            s.current.coverage = outcomeCoverage;
            return s;
          })()
        : null,
    },
    selectedForm,
    formDefinitionAcknowledged: forms !== null,
    trendGranularity: null,
  };

  const parsed = normalizedReportSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`fixture is not schema-valid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  return parsed.data;
}

/** Builds a matched, tracked, commercial rank-tracker cohort. */
export function cohort(
  members: Array<{ baseline: number | null; current: number | null; count?: number }>,
): KeywordRow[] {
  const rows: KeywordRow[] = [];
  let index = 0;
  for (const member of members) {
    for (let n = 0; n < (member.count ?? 1); n += 1) {
      index += 1;
      const keyword = `term ${String(index).padStart(3, '0')}`;
      rows.push({
        period: 'baseline',
        keyword,
        device: 'desktop',
        location: 'US',
        searchEngine: 'google',
        position: member.baseline,
        intent: 'commercial',
        tracked: true,
      });
      rows.push({
        period: 'current',
        keyword,
        device: 'desktop',
        location: 'US',
        searchEngine: 'google',
        position: member.current,
        intent: 'commercial',
        tracked: true,
      });
    }
  }
  return rows;
}

export function outcome(
  metric: OutcomeRow['metric'],
  baselineValue: number | null,
  currentValue: number | null,
  overrides: Partial<OutcomeRow> = {},
): OutcomeRow {
  return {
    metric,
    baselineValue,
    currentValue,
    scope: 'organic_search',
    currency: metric === 'revenue' ? 'USD' : null,
    sourceKind: 'crm',
    sourceLabel: 'Fictional CRM export',
    definitionVersion: 'crm-v1',
    coverage: 'complete',
    attributionNote: 'Last non-direct click, deduplicated by email.',
    ...overrides,
  };
}

export function complaint(overrides: Partial<ComplaintInput> = {}): ComplaintInput {
  return {
    originalText: 'SEO isn’t working. We haven’t gotten any leads.',
    category: 'no_leads',
    scope: 'organic_search',
    periodStart: '2026-07-12',
    periodEnd: '2026-08-10',
    receivedAt: '2026-08-11T09:00:00.000Z',
    ...overrides,
  };
}
