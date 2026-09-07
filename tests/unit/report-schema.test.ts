import { describe, expect, it } from 'vitest';
import { normalizedReportSchema } from '@/domain/report-schema';
import { complaintInputSchema } from '@/domain/complaint-schema';
import { makeValidReportInput } from '../fixtures/report-builder';

/** Collects the dotted paths Zod reported, so tests can assert on named fields. */
function failurePaths(input: unknown): string[] {
  const parsed = normalizedReportSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('normalized report schema', () => {
  it('accepts two complete adjacent 30-day windows', () => {
    const parsed = normalizedReportSchema.safeParse(makeValidReportInput());
    expect(parsed.success).toBe(true);
  });

  it('rejects a lead-session count larger than its session count', () => {
    const input = makeValidReportInput();
    input.datasets.organic[1].leadSessions = 99_999;
    expect(failurePaths(input)).toContain('datasets.organic');
  });

  it('rejects fractional and negative counts', () => {
    const fractional = makeValidReportInput();
    fractional.datasets.organic[0].sessions = 7210.5;
    expect(failurePaths(fractional)).toContain('datasets.organic.0.sessions');

    const negative = makeValidReportInput();
    negative.datasets.organic[0].sessions = -1;
    expect(failurePaths(negative)).toContain('datasets.organic.0.sessions');
  });

  it('rejects non-finite counts', () => {
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const input = makeValidReportInput();
      input.datasets.organic[0].sessions = value;
      expect(failurePaths(input)).toContain('datasets.organic.0.sessions');
    }
  });

  it('accepts a missing lead-session count as an explicit unknown', () => {
    const input = makeValidReportInput();
    input.datasets.organic[0].leadSessions = null;
    input.datasets.organic[1].leadSessions = null;
    const parsed = normalizedReportSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.datasets.organic[0].leadSessions).toBeNull();
    }
  });

  it('requires exactly one baseline row and one current row', () => {
    const duplicated = makeValidReportInput();
    duplicated.datasets.organic[1].period = 'baseline';
    expect(failurePaths(duplicated)).toContain('datasets.organic');
  });

  it('rejects a landing-page path containing a query string or fragment', () => {
    for (const path of ['/seo?utm=1', '/seo#top', 'seo-services']) {
      const input = makeValidReportInput();
      input.datasets.landingPages = [
        { period: 'current', path, sessions: 10 },
        { period: 'baseline', path, sessions: 5 },
      ];
      expect(failurePaths(input).some((p) => p.startsWith('datasets.landingPages'))).toBe(true);
    }
  });

  it('rejects a duplicate keyword cohort key within one period', () => {
    const input = makeValidReportInput();
    const row = {
      period: 'current' as const,
      keyword: 'Seo Services',
      device: 'desktop',
      location: 'US',
      searchEngine: 'google',
      position: 4,
      intent: 'commercial' as const,
      tracked: true,
    };
    input.datasets.keywords = [row, { ...row, keyword: 'seo services' }];
    expect(failurePaths(input)).toContain('datasets.keywords');
  });

  it('rejects a form row whose failures exceed its attempts', () => {
    const input = makeValidReportInput();
    input.datasets.forms = [
      { period: 'baseline', formId: 'contact', scope: 'organic_search', attempts: 10, failedAttempts: 20, errorEvents: 20 },
      { period: 'current', formId: 'contact', scope: 'organic_search', attempts: 10, failedAttempts: 1, errorEvents: 1 },
    ];
    expect(failurePaths(input).some((p) => p.startsWith('datasets.forms'))).toBe(true);
  });

  it('rejects qualified leads exceeding received leads in the same period', () => {
    const input = makeValidReportInput();
    input.datasets.outcomes = [
      { metric: 'received_leads', baselineValue: 10, currentValue: 10, scope: 'organic_search', currency: null, sourceKind: 'crm', sourceLabel: 'Demo CRM', definitionVersion: '1', coverage: 'complete', attributionNote: 'n/a' },
      { metric: 'qualified_leads', baselineValue: 10, currentValue: 40, scope: 'organic_search', currency: null, sourceKind: 'crm', sourceLabel: 'Demo CRM', definitionVersion: '1', coverage: 'complete', attributionNote: 'n/a' },
    ];
    expect(failurePaths(input)).toContain('datasets.outcomes');
  });

  it('rejects revenue without a currency', () => {
    const input = makeValidReportInput();
    input.datasets.outcomes = [
      { metric: 'revenue', baselineValue: 1000, currentValue: 900, scope: 'organic_search', currency: null, sourceKind: 'crm', sourceLabel: 'Demo CRM', definitionVersion: '1', coverage: 'complete', attributionNote: 'n/a' },
    ];
    expect(failurePaths(input).some((p) => p.startsWith('datasets.outcomes'))).toBe(true);
  });

  it('rejects a manual source with no evidence note', () => {
    const input = makeValidReportInput();
    input.sources.organic.current.sourceKind = 'manual';
    input.sources.organic.current.sourceLabel = '';
    expect(failurePaths(input).some((p) => p.startsWith('sources.organic.current'))).toBe(true);
  });
});

describe('complaint schema', () => {
  it('accepts a complaint whose window matches the reporting period exactly', () => {
    const parsed = complaintInputSchema.safeParse({
      originalText: 'SEO isn’t working. We haven’t gotten any leads.',
      category: 'no_leads',
      scope: 'organic_search',
      periodStart: '2026-07-12',
      periodEnd: '2026-08-10',
      receivedAt: '2026-08-11T09:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const parsed = complaintInputSchema.safeParse({
      originalText: 'x',
      category: 'seo_is_bad',
      scope: 'organic_search',
      periodStart: '2026-07-12',
      periodEnd: '2026-08-10',
      receivedAt: '2026-08-11T09:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects complaint text beyond 5000 characters', () => {
    const parsed = complaintInputSchema.safeParse({
      originalText: 'a'.repeat(5001),
      category: 'no_leads',
      scope: 'organic_search',
      periodStart: '2026-07-12',
      periodEnd: '2026-08-10',
      receivedAt: '2026-08-11T09:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a complaint window that ends before it starts', () => {
    const parsed = complaintInputSchema.safeParse({
      originalText: 'x',
      category: 'no_leads',
      scope: 'organic_search',
      periodStart: '2026-08-10',
      periodEnd: '2026-07-12',
      receivedAt: '2026-08-11T09:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });
});
