import type {
  DatasetSource,
  KeywordRow,
  NormalizedReport,
  PeriodSources,
  TrendRow,
} from '../report-schema';

/**
 * The fictional demo scenario from specification section 11.
 *
 * Everything here is invented. "Northstar Services" is not a real company and
 * `example.com` is the IANA reserved documentation domain. The tracking
 * verification note is explicitly labelled as demo evidence.
 */

/** Fixed instant so the demo and its tests are deterministic. */
export const DEMO_NOW = '2026-08-11T12:00:00Z';
export const DEMO_EXPORTED_AT = '2026-08-11T12:00:00.000Z';
export const DEMO_CLIENT_NAME = 'Northstar Services';
export const DEMO_CLIENT_DOMAIN = 'example.com';
export const DEMO_AGENCY_NAME = 'Demo Agency';
export const DEMO_TIME_ZONE = 'America/New_York';

const BASELINE_START = '2026-06-12';
const BASELINE_END = '2026-07-11';
const CURRENT_START = '2026-07-12';
const CURRENT_END = '2026-08-10';

/** Subtracts whole calendar days from an ISO local date without touching zones. */
function subtractDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d - days));
  return shifted.toISOString().slice(0, 10);
}

function source(overrides: Partial<DatasetSource> & Pick<DatasetSource, 'sourceKind' | 'sourceLabel'>): DatasetSource {
  return {
    exportedAt: DEMO_EXPORTED_AT,
    coverage: 'complete',
    scopeKey: `property=northstar-demo;channel=organic_search;country=US;device=all`,
    definitionVersion: 'demo-v1',
    timeZone: DEMO_TIME_ZONE,
    acknowledgedTimeZoneDifference: false,
    evidenceNote: null,
    ...overrides,
  };
}

function bothPeriods(base: DatasetSource): PeriodSources {
  return { baseline: { ...base }, current: { ...base } };
}

/**
 * 100 matched, tracked, commercial members on one desktop/US/Google cohort.
 *   members 1-54   rank 5 in both periods      -> in the top 10 throughout
 *   members 55-85  move from 18 to 6           -> 31 members enter the top 10
 *   members 86-100 stay at 22                  -> never in the top 10
 * Expected: baseline top-10 54, current top-10 85, entered 31, exited 0, net +31.
 */
function demoKeywords(): KeywordRow[] {
  const rows: KeywordRow[] = [];
  for (let member = 1; member <= 100; member += 1) {
    const label = `northstar service term ${String(member).padStart(3, '0')}`;
    const [baselinePosition, currentPosition] =
      member <= 54 ? [5, 5] : member <= 85 ? [18, 6] : [22, 22];
    for (const [period, position] of [
      ['baseline', baselinePosition],
      ['current', currentPosition],
    ] as const) {
      rows.push({
        period,
        keyword: label,
        device: 'desktop',
        location: 'US',
        searchEngine: 'google',
        position,
        intent: 'commercial',
        tracked: true,
      });
    }
  }
  return rows;
}

/**
 * Six non-overlapping 30-day buckets. Each start is its end minus 29 calendar
 * days, so the final two buckets coincide exactly with the baseline and current
 * windows and must therefore report the same totals as the summary.
 */
function demoTrend(): TrendRow[] {
  const ends = ['2026-03-13', '2026-04-12', '2026-05-12', '2026-06-11', '2026-07-11', '2026-08-10'];
  const sessions = [3500, 5200, 7000, 9000, 7210, 12540];
  const activeUsers = [2800, 4100, 5600, 7300, 5800, 10150];
  return ends.map((endDate, index) => ({
    startDate: subtractDays(endDate, 29),
    endDate,
    sessions: sessions[index],
    activeUsers: activeUsers[index],
  }));
}

/** Returns a fresh, independent object on every call. */
export function makeDemoReport(): NormalizedReport {
  const analytics = source({
    sourceKind: 'ga4_export',
    sourceLabel: 'Fictional analytics export (demo)',
  });
  const rankTracker = source({
    sourceKind: 'rank_tracker',
    sourceLabel: 'Fictional rank tracker export (demo)',
    definitionVersion: 'demo-rank-v1',
    scopeKey: 'cohort=northstar-demo;device=desktop;country=US;engine=google',
  });
  const formBackend = source({
    sourceKind: 'form_backend',
    sourceLabel: 'Fictional form backend export (demo)',
    definitionVersion: 'demo-form-v1',
    scopeKey: 'form=contact;channel=organic_search',
  });

  return {
    schemaVersion: 1,
    metadata: {
      reportLabel: '10 August 2026 Report',
      currentStart: CURRENT_START,
      currentEnd: CURRENT_END,
      baselineStart: BASELINE_START,
      baselineEnd: BASELINE_END,
      timeZone: DEMO_TIME_ZONE,
      channel: 'organic_search',
      propertyLabel: `${DEMO_CLIENT_NAME} — ${DEMO_CLIENT_DOMAIN}`,
      leadDefinition: 'Sessions containing the contact form submission key event',
      leadEventName: 'generate_lead',
      trackingStatus: 'verified',
      trackingEvidenceNote:
        'Fictional demo evidence: tagging reviewed against the form backend on 11 August 2026. This is sample data, not a real audit.',
      trackingReviewedAt: '2026-08-11T10:00:00.000Z',
      trackingReviewedBy: 'Demo Analyst',
    },
    datasets: {
      organic: [
        { period: 'baseline', sessions: 7210, activeUsers: 5800, leadSessions: 151 },
        { period: 'current', sessions: 12540, activeUsers: 10150, leadSessions: 150 },
      ],
      keywords: demoKeywords(),
      forms: [
        {
          period: 'baseline',
          formId: 'contact',
          scope: 'organic_search',
          attempts: 200,
          failedAttempts: 5,
          errorEvents: 5,
        },
        {
          period: 'current',
          formId: 'contact',
          scope: 'organic_search',
          attempts: 220,
          failedAttempts: 15,
          errorEvents: 15,
        },
      ],
      landingPages: [
        { period: 'baseline', path: '/seo-services', sessions: 1250 },
        { period: 'current', path: '/seo-services', sessions: 2340 },
        { period: 'baseline', path: '/digital-marketing', sessions: 1174 },
        { period: 'current', path: '/digital-marketing', sessions: 1890 },
        { period: 'baseline', path: '/content-writing', sessions: 814 },
        { period: 'current', path: '/content-writing', sessions: 1245 },
      ],
      trafficTrend: demoTrend(),
      // No CRM or received-lead evidence is supplied, so no outcome can be claimed.
      outcomes: null,
    },
    sources: {
      organic: bothPeriods(analytics),
      keywords: bothPeriods(rankTracker),
      forms: bothPeriods(formBackend),
      landingPages: bothPeriods(analytics),
      trafficTrend: bothPeriods(analytics),
      outcomes: null,
    },
    selectedForm: { formId: 'contact', scope: 'organic_search' },
    formDefinitionAcknowledged: true,
    trendGranularity: 'period',
  };
}
