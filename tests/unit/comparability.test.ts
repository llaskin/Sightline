import { describe, expect, it } from 'vitest';
import { normalizedReportSchema } from '@/domain/report-schema';
import { validateComparability, inclusiveDayCount, localDateInZone } from '@/domain/comparability';
import { makeValidReportInput } from '../fixtures/report-builder';

const NOW = new Date('2026-08-11T12:00:00Z');

function report(mutate: (input: ReturnType<typeof makeValidReportInput>) => void = () => {}) {
  const input = makeValidReportInput();
  mutate(input);
  const parsed = normalizedReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`fixture is not schema-valid: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

describe('calendar arithmetic', () => {
  it('counts inclusive calendar days independently of daylight saving', () => {
    // 2026-03-08 is the US spring-forward day: that local day is 23 hours long.
    expect(inclusiveDayCount('2026-03-01', '2026-03-28')).toBe(28);
    expect(inclusiveDayCount('2026-07-12', '2026-08-10')).toBe(30);
    expect(inclusiveDayCount('2026-08-10', '2026-08-10')).toBe(1);
  });

  it('resolves today in the report time zone rather than the host zone', () => {
    // 03:30 UTC on 12 August is still 11 August in New York.
    expect(localDateInZone(new Date('2026-08-12T03:30:00Z'), 'America/New_York')).toBe('2026-08-11');
    expect(localDateInZone(new Date('2026-08-12T03:30:00Z'), 'UTC')).toBe('2026-08-12');
  });
});

describe('window comparability', () => {
  it('accepts two complete adjacent 30-day windows', () => {
    const result = validateComparability(report(), NOW);
    expect(result.windowErrors).toEqual([]);
    expect(result.baseEligible).toBe(true);
  });

  it('accepts equal calendar lengths that span a daylight-saving change', () => {
    const result = validateComparability(
      report((input) => {
        input.metadata.baselineStart = '2026-02-08';
        input.metadata.baselineEnd = '2026-03-07';
        input.metadata.currentStart = '2026-03-08';
        input.metadata.currentEnd = '2026-04-04';
      }),
      new Date('2026-04-06T12:00:00Z'),
    );
    expect(result.windowErrors).toEqual([]);
    expect(result.currentDayCount).toBe(28);
    expect(result.baselineDayCount).toBe(28);
  });

  it('names the offending date fields for overlapping windows', () => {
    const result = validateComparability(
      report((input) => {
        input.metadata.baselineEnd = '2026-07-20';
      }),
      NOW,
    );
    expect(result.windowErrors.some((e) => e.field === 'baselineEnd')).toBe(true);
    expect(result.baseEligible).toBe(false);
  });

  it('rejects a current window that has not finished in the report time zone', () => {
    const result = validateComparability(report(), new Date('2026-08-10T18:00:00Z'));
    expect(result.windowErrors.some((e) => e.field === 'currentEnd')).toBe(true);
  });

  it('rejects windows shorter than 7 or longer than 93 days', () => {
    const tooShort = validateComparability(
      report((input) => {
        input.metadata.baselineStart = '2026-08-01';
        input.metadata.baselineEnd = '2026-08-06';
        input.metadata.currentStart = '2026-08-07';
        input.metadata.currentEnd = '2026-08-12';
      }),
      new Date('2026-08-20T12:00:00Z'),
    );
    expect(tooShort.windowErrors.some((e) => e.code === 'WINDOW_LENGTH')).toBe(true);

    const tooLong = validateComparability(
      report((input) => {
        input.metadata.baselineStart = '2025-12-01';
        input.metadata.baselineEnd = '2026-03-08';
        input.metadata.currentStart = '2026-03-09';
        input.metadata.currentEnd = '2026-06-14';
      }),
      new Date('2026-08-20T12:00:00Z'),
    );
    expect(tooLong.windowErrors.some((e) => e.code === 'WINDOW_LENGTH')).toBe(true);
  });

  it('rejects windows of unequal length', () => {
    const result = validateComparability(
      report((input) => {
        input.metadata.currentEnd = '2026-08-09';
      }),
      NOW,
    );
    expect(result.windowErrors.some((e) => e.code === 'WINDOW_LENGTH_MISMATCH')).toBe(true);
  });
});

describe('evidence eligibility', () => {
  it('keeps organic data eligible when an optional dataset is only partially covered', () => {
    const result = validateComparability(
      report((input) => {
        input.sources.forms = {
          baseline: { ...input.sources.organic.baseline, sourceKind: 'form_backend', coverage: 'partial' },
          current: { ...input.sources.organic.current, sourceKind: 'form_backend', coverage: 'partial' },
        };
        input.datasets.forms = [
          { period: 'baseline', formId: 'contact', scope: 'organic_search', attempts: 200, failedAttempts: 5, errorEvents: 5 },
          { period: 'current', formId: 'contact', scope: 'organic_search', attempts: 220, failedAttempts: 15, errorEvents: 15 },
        ];
        input.selectedForm = { formId: 'contact', scope: 'organic_search' };
      }),
      NOW,
    );
    expect(result.baseEligible).toBe(true);
    expect(result.datasetFlags.forms.eligible).toBe(false);
    expect(result.datasetFlags.forms.reasons).toContain('COVERAGE_NOT_COMPLETE');
  });

  it('marks organic ineligible when its coverage is not complete, keeping the values readable', () => {
    const result = validateComparability(
      report((input) => {
        input.sources.organic.baseline.coverage = 'partial';
      }),
      NOW,
    );
    expect(result.baseEligible).toBe(false);
    expect(result.datasetFlags.organic.reasons).toContain('COVERAGE_NOT_COMPLETE');
    expect(result.measurementIssue).toBe(false);
  });

  it('treats differing organic definitions between periods as a measurement issue', () => {
    const result = validateComparability(
      report((input) => {
        input.sources.organic.current.definitionVersion = 'ga4-lead-v2';
      }),
      NOW,
    );
    expect(result.measurementIssue).toBe(true);
    expect(result.measurementReasons).toContain('ORGANIC_DEFINITION_MISMATCH');
  });

  it('treats differing organic scope keys between periods as a measurement issue', () => {
    const result = validateComparability(
      report((input) => {
        input.sources.organic.current.scopeKey = 'property=2;channel=organic_search';
      }),
      NOW,
    );
    expect(result.measurementIssue).toBe(true);
    expect(result.measurementReasons).toContain('ORGANIC_SCOPE_MISMATCH');
  });

  it('treats a declared tracking problem as a measurement issue', () => {
    const result = validateComparability(
      report((input) => {
        input.metadata.trackingStatus = 'known_issue';
      }),
      NOW,
    );
    expect(result.measurementIssue).toBe(true);
    expect(result.measurementReasons).toContain('TRACKING_KNOWN_ISSUE');
  });

  it('does not treat merely missing optional data as a measurement issue', () => {
    const result = validateComparability(report(), NOW);
    expect(result.measurementIssue).toBe(false);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('reports fewer than 100 sessions in either period as an eligibility gap, not a rejection', () => {
    const result = validateComparability(
      report((input) => {
        input.datasets.organic[0].sessions = 99;
        input.datasets.organic[0].leadSessions = 3;
      }),
      NOW,
    );
    expect(result.baseEligible).toBe(false);
    expect(result.datasetFlags.organic.reasons).toContain('MINIMUM_SESSIONS');
  });

  it('keeps an optional source in a different time zone as context with a caveat', () => {
    const result = validateComparability(
      report((input) => {
        input.sources.keywords = {
          baseline: { ...input.sources.organic.baseline, sourceKind: 'gsc', timeZone: 'America/Los_Angeles' },
          current: { ...input.sources.organic.current, sourceKind: 'gsc', timeZone: 'America/Los_Angeles' },
        };
        input.datasets.keywords = [];
      }),
      NOW,
    );
    expect(result.datasetFlags.keywords.caveats).toContain('SOURCE_TIME_ZONE_DIFFERS');
    // The original zone is retained and never relabelled to the report zone.
    expect(result.datasetFlags.keywords.timeZone).toBe('America/Los_Angeles');
    expect(result.measurementIssue).toBe(false);
  });

  it('treats an organic source time zone differing from the report as a measurement issue', () => {
    const result = validateComparability(
      report((input) => {
        input.sources.organic.current.timeZone = 'America/Los_Angeles';
      }),
      NOW,
    );
    expect(result.measurementIssue).toBe(true);
    expect(result.measurementReasons).toContain('ORGANIC_TIME_ZONE_MISMATCH');
  });
});

describe('complaint period alignment', () => {
  it('aligns when the complaint window equals the current reporting window exactly', () => {
    const result = validateComparability(report(), NOW);
    expect(result.currentWindow).toEqual({ start: '2026-07-12', end: '2026-08-10' });
  });
});
