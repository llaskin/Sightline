/**
 * A minimal schema-valid report used as a starting point for negative tests.
 * Every test mutates a fresh copy, so cases can never leak into one another.
 * Values are deliberately plain; the richer fictional demo lives in
 * `src/domain/fixtures/demo-report.ts`.
 */
export function makeValidReportInput() {
  const source = (sourceKind: string) => ({
    sourceKind,
    sourceLabel: 'Fictional analytics export',
    exportedAt: '2026-08-11T12:00:00.000Z',
    coverage: 'complete',
    scopeKey: 'property=1;channel=organic_search;country=US',
    definitionVersion: 'ga4-lead-v1',
    timeZone: 'America/New_York',
    acknowledgedTimeZoneDifference: false,
    evidenceNote: null as string | null,
  });

  return {
    schemaVersion: 1 as const,
    metadata: {
      reportLabel: '10 August 2026 Report',
      currentStart: '2026-07-12',
      currentEnd: '2026-08-10',
      baselineStart: '2026-06-12',
      baselineEnd: '2026-07-11',
      timeZone: 'America/New_York',
      channel: 'organic_search',
      propertyLabel: 'Northstar Services — example.com',
      leadDefinition: 'Sessions containing the contact form submission key event',
      leadEventName: 'generate_lead',
      trackingStatus: 'verified',
      trackingEvidenceNote: 'Fictional demo evidence: tag assistant screenshot reviewed.',
      trackingReviewedAt: '2026-08-11T10:00:00.000Z',
      trackingReviewedBy: 'Demo Analyst',
    },
    datasets: {
      organic: [
        { period: 'baseline', sessions: 7210, activeUsers: 5800, leadSessions: 151 },
        { period: 'current', sessions: 12540, activeUsers: 10150, leadSessions: 150 },
      ] as Array<{
        period: string;
        sessions: number;
        activeUsers: number | null;
        leadSessions: number | null;
      }>,
      keywords: null as unknown[] | null,
      forms: null as unknown[] | null,
      landingPages: null as unknown[] | null,
      trafficTrend: null as unknown[] | null,
      outcomes: null as unknown[] | null,
    },
    sources: {
      organic: { baseline: source('ga4_export'), current: source('ga4_export') },
      keywords: null as { baseline: ReturnType<typeof source>; current: ReturnType<typeof source> } | null,
      forms: null as { baseline: ReturnType<typeof source>; current: ReturnType<typeof source> } | null,
      landingPages: null as { baseline: ReturnType<typeof source>; current: ReturnType<typeof source> } | null,
      trafficTrend: null as { baseline: ReturnType<typeof source>; current: ReturnType<typeof source> } | null,
      outcomes: null as { baseline: ReturnType<typeof source>; current: ReturnType<typeof source> } | null,
    },
    selectedForm: null as { formId: string; scope: string } | null,
    formDefinitionAcknowledged: false,
    trendGranularity: null as string | null,
  };
}
