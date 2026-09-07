import { describe, expect, it } from 'vitest';
import {
  relativeChange,
  rate,
  percentagePointChange,
  compareKeywordCohort,
  compareSelectedForm,
  errorEventMultiple,
} from '@/domain/metrics';
import type { KeywordRow, FormRow } from '@/domain/report-schema';

describe('metric arithmetic', () => {
  it('calculates change from exact counts', () => {
    const traffic = relativeChange(12540, 7210);
    expect(traffic.kind).toBe('relative');
    if (traffic.kind === 'relative') expect(traffic.percent).toBeCloseTo(73.925104, 5);
    const before = rate(151, 7210);
    const after = rate(150, 12540);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    const conversion = relativeChange(after, before);
    expect(conversion.kind).toBe('relative');
    if (conversion.kind === 'relative') {
      expect(conversion.percent).toBeCloseTo(-42.884756, 5);
    }
    expect(percentagePointChange(after, before)).toBeCloseTo(-0.898141, 5);
  });

  it('preserves zero and unknown as distinct states', () => {
    expect(relativeChange(5, 0)).toEqual({ kind: 'new', absolute: 5 });
    expect(relativeChange(0, 0)).toEqual({ kind: 'no_activity', absolute: 0 });
    expect(relativeChange(0, 10)).toEqual({ kind: 'relative', percent: -100, absolute: -10 });
    expect(relativeChange(null, 10).kind).toBe('unavailable');
    expect(rate(0, 0)).toBeNull();
    expect(rate(null, 100)).toBeNull();
  });

  it('never emits NaN or Infinity from any combination of zero and null', () => {
    const inputs: Array<number | null> = [null, 0, 1, 100];
    for (const current of inputs) {
      for (const baseline of inputs) {
        const change = relativeChange(current, baseline);
        if (change.kind === 'relative') {
          expect(Number.isFinite(change.percent)).toBe(true);
          expect(Number.isFinite(change.absolute)).toBe(true);
        }
        if (change.kind === 'new') expect(Number.isFinite(change.absolute)).toBe(true);
      }
    }
  });

  it('reports a rate of exactly zero rather than treating it as unknown', () => {
    expect(rate(0, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Keyword cohort
// ---------------------------------------------------------------------------

function keyword(overrides: Partial<KeywordRow> & Pick<KeywordRow, 'period' | 'keyword'>): KeywordRow {
  return {
    device: 'desktop',
    location: 'US',
    searchEngine: 'google',
    position: 5,
    intent: 'commercial',
    tracked: true,
    ...overrides,
  } as KeywordRow;
}

const rankTrackerSources = {
  baseline: { sourceKind: 'rank_tracker' as const },
  current: { sourceKind: 'rank_tracker' as const },
};

describe('keyword cohort comparison', () => {
  it('counts net top-10 change as entered minus exited, not the number entering', () => {
    const rows: KeywordRow[] = [];
    // 10 members enter the top 10.
    for (let i = 0; i < 10; i += 1) {
      rows.push(keyword({ period: 'baseline', keyword: `enter ${i}`, position: 18 }));
      rows.push(keyword({ period: 'current', keyword: `enter ${i}`, position: 6 }));
    }
    // 3 members leave it.
    for (let i = 0; i < 3; i += 1) {
      rows.push(keyword({ period: 'baseline', keyword: `exit ${i}`, position: 4 }));
      rows.push(keyword({ period: 'current', keyword: `exit ${i}`, position: 15 }));
    }
    const result = compareKeywordCohort(rows, rankTrackerSources);
    expect(result.entered).toBe(10);
    expect(result.exited).toBe(3);
    expect(result.netTop10Change).toBe(7);
    expect(result.eligibleMembers).toBe(13);
  });

  it('excludes a member whose row is missing in one period as unknown', () => {
    const rows: KeywordRow[] = [
      keyword({ period: 'baseline', keyword: 'both', position: 12 }),
      keyword({ period: 'current', keyword: 'both', position: 4 }),
      keyword({ period: 'baseline', keyword: 'only baseline', position: 12 }),
    ];
    const result = compareKeywordCohort(rows, rankTrackerSources);
    expect(result.eligibleMembers).toBe(1);
    expect(result.excludedUnknown).toBe(1);
  });

  it('treats a blank position on a present row as confirmed unranked, not rank 100', () => {
    const rows: KeywordRow[] = [
      keyword({ period: 'baseline', keyword: 'falls out', position: 8 }),
      keyword({ period: 'current', keyword: 'falls out', position: null }),
    ];
    const result = compareKeywordCohort(rows, rankTrackerSources);
    expect(result.eligibleMembers).toBe(1);
    expect(result.exited).toBe(1);
    expect(result.netTop10Change).toBe(-1);
    const movement = result.movements[0];
    expect(movement.currentPosition).toBeNull();
    expect(movement.movement).toBeNull();
    expect(movement.transition).toBe('left_ranking');
  });

  it('excludes members that are not tracked or not commercial in both periods', () => {
    const rows: KeywordRow[] = [
      keyword({ period: 'baseline', keyword: 'informational', intent: 'informational', position: 12 }),
      keyword({ period: 'current', keyword: 'informational', intent: 'informational', position: 4 }),
      keyword({ period: 'baseline', keyword: 'untracked', tracked: false, position: 12 }),
      keyword({ period: 'current', keyword: 'untracked', tracked: false, position: 4 }),
      keyword({ period: 'baseline', keyword: 'mixed intent', intent: 'commercial', position: 12 }),
      keyword({ period: 'current', keyword: 'mixed intent', intent: 'unknown', position: 4 }),
    ];
    const result = compareKeywordCohort(rows, rankTrackerSources);
    expect(result.eligibleMembers).toBe(0);
  });

  it('never lets Search Console rows become fixed-cohort rank evidence', () => {
    const rows: KeywordRow[] = [
      keyword({ period: 'baseline', keyword: 'gsc term', position: 12 }),
      keyword({ period: 'current', keyword: 'gsc term', position: 4 }),
    ];
    const result = compareKeywordCohort(rows, {
      baseline: { sourceKind: 'gsc' },
      current: { sourceKind: 'gsc' },
    });
    expect(result.fixedCohortEligible).toBe(false);
    expect(result.ineligibleReasons).toContain('NOT_RANK_TRACKER');
    // Descriptive context is still available.
    expect(result.currentTop10).toBe(1);
  });

  it('never pools a Search Console period with a rank-tracker period', () => {
    const result = compareKeywordCohort([], {
      baseline: { sourceKind: 'gsc' },
      current: { sourceKind: 'rank_tracker' },
    });
    expect(result.fixedCohortEligible).toBe(false);
    expect(result.ineligibleReasons).toContain('MIXED_SOURCE_KINDS');
  });

  it('reports improvement as a positive signed movement', () => {
    const rows: KeywordRow[] = [
      keyword({ period: 'baseline', keyword: 'improves', position: 18 }),
      keyword({ period: 'current', keyword: 'improves', position: 6 }),
    ];
    const result = compareKeywordCohort(rows, rankTrackerSources);
    expect(result.movements[0].movement).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function form(overrides: Partial<FormRow> & Pick<FormRow, 'period'>): FormRow {
  return {
    formId: 'contact',
    scope: 'organic_search',
    attempts: 100,
    failedAttempts: 5,
    errorEvents: 5,
    ...overrides,
  } as FormRow;
}

describe('selected form comparison', () => {
  it('keeps the failure rate unchanged when error counts and attempts rise together', () => {
    const result = compareSelectedForm(
      [
        form({ period: 'baseline', attempts: 100, failedAttempts: 5, errorEvents: 5 }),
        form({ period: 'current', attempts: 300, failedAttempts: 15, errorEvents: 15 }),
      ],
      { formId: 'contact', scope: 'organic_search' },
    );
    expect(result.baselineFailureRate).toBeCloseTo(0.05, 10);
    expect(result.currentFailureRate).toBeCloseTo(0.05, 10);
    expect(result.percentagePointChange).toBeCloseTo(0, 10);
    // The raw count still tripled; it is reported separately as context.
    expect(result.errorEventMultiple).toBeCloseTo(3, 10);
  });

  it('computes the demo form deterioration exactly', () => {
    const result = compareSelectedForm(
      [
        form({ period: 'baseline', attempts: 200, failedAttempts: 5, errorEvents: 5 }),
        form({ period: 'current', attempts: 220, failedAttempts: 15, errorEvents: 15 }),
      ],
      { formId: 'contact', scope: 'organic_search' },
    );
    expect(result.baselineFailureRate).toBeCloseTo(0.025, 10);
    expect(result.currentFailureRate).toBeCloseTo(0.0681818, 6);
    expect(result.percentagePointChange).toBeCloseTo(4.3181818, 5);
    expect(result.relativeChange.kind).toBe('relative');
    if (result.relativeChange.kind === 'relative') {
      expect(result.relativeChange.percent).toBeCloseTo(172.727273, 5);
    }
    expect(result.errorEventMultiple).toBeCloseTo(3, 10);
  });

  it('reports an unavailable failure rate when attempts are zero or unknown', () => {
    const zero = compareSelectedForm(
      [
        form({ period: 'baseline', attempts: 0, failedAttempts: 0, errorEvents: 0 }),
        form({ period: 'current', attempts: 0, failedAttempts: 0, errorEvents: 0 }),
      ],
      { formId: 'contact', scope: 'organic_search' },
    );
    expect(zero.baselineFailureRate).toBeNull();

    const unknown = compareSelectedForm(
      [
        form({ period: 'baseline', attempts: null, failedAttempts: null, errorEvents: 5 }),
        form({ period: 'current', attempts: null, failedAttempts: null, errorEvents: 15 }),
      ],
      { formId: 'contact', scope: 'organic_search' },
    );
    expect(unknown.currentFailureRate).toBeNull();
    expect(unknown.errorEventMultiple).toBeCloseTo(3, 10);
  });

  it('only uses the single selected form and scope', () => {
    const result = compareSelectedForm(
      [
        form({ period: 'baseline', formId: 'contact', attempts: 200, failedAttempts: 5, errorEvents: 5 }),
        form({ period: 'current', formId: 'contact', attempts: 220, failedAttempts: 15, errorEvents: 15 }),
        form({ period: 'baseline', formId: 'newsletter', attempts: 900, failedAttempts: 900, errorEvents: 900 }),
        form({ period: 'current', formId: 'newsletter', attempts: 900, failedAttempts: 0, errorEvents: 0 }),
      ],
      { formId: 'contact', scope: 'organic_search' },
    );
    expect(result.baselineAttempts).toBe(200);
    expect(result.currentAttempts).toBe(220);
  });

  it('does not match a row whose scope differs from the selection', () => {
    const result = compareSelectedForm(
      [
        form({ period: 'baseline', scope: 'all_channels' }),
        form({ period: 'current', scope: 'all_channels' }),
      ],
      { formId: 'contact', scope: 'organic_search' },
    );
    expect(result.matched).toBe(false);
  });

  it('never returns Infinity when the baseline error count is zero', () => {
    expect(errorEventMultiple(15, 0)).toBeNull();
    expect(errorEventMultiple(0, 0)).toBeNull();
    expect(errorEventMultiple(15, 5)).toBe(3);
  });
});
