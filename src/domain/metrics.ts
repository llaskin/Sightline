import type { Change } from './analysis-schema';
import type { FormRow, KeywordRow, Scope, SourceKind } from './report-schema';
import { keywordCohortKey } from './report-schema';

/**
 * Decision arithmetic. Values stay unrounded here; rounding belongs to
 * `src/lib/format.ts` and happens only at display time.
 */

export function relativeChange(current: number | null, baseline: number | null): Change {
  if (current === null || baseline === null) {
    return { kind: 'unavailable', reason: 'A comparison value was not provided' };
  }
  const absolute = current - baseline;
  if (baseline === 0) {
    return current === 0 ? { kind: 'no_activity', absolute: 0 } : { kind: 'new', absolute };
  }
  return { kind: 'relative', percent: (absolute / baseline) * 100, absolute };
}

/**
 * A ratio, or `null` when it cannot be computed. A zero denominator is
 * unavailable rather than zero, even when the numerator is also zero.
 */
export function rate(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0
    ? null
    : numerator / denominator;
}

export function percentagePointChange(
  current: number | null,
  baseline: number | null,
): number | null {
  return current === null || baseline === null ? null : (current - baseline) * 100;
}

/** `null` rather than Infinity when the baseline count is zero. */
export function errorEventMultiple(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null || baseline === 0) return null;
  return current / baseline;
}

// ---------------------------------------------------------------------------
// Keyword cohort
// ---------------------------------------------------------------------------

export const TOP_10_MAX_POSITION = 10;

export type KeywordMovement = {
  key: string;
  keyword: string;
  device: string;
  location: string;
  searchEngine: string;
  baselinePosition: number | null;
  currentPosition: number | null;
  /** Positive means improved. `null` whenever either end is unranked. */
  movement: number | null;
  transition: 'ranked' | 'entered_ranking' | 'left_ranking' | 'unranked_both';
  enteredTop10: boolean;
  exitedTop10: boolean;
};

export type KeywordCohortComparison = {
  fixedCohortEligible: boolean;
  ineligibleReasons: string[];
  eligibleMembers: number;
  excludedUnknown: number;
  excludedIneligible: number;
  baselineTop10: number;
  currentTop10: number;
  entered: number;
  exited: number;
  netTop10Change: number;
  movements: KeywordMovement[];
};

type CohortSources = {
  baseline: { sourceKind: SourceKind | 'rank_tracker' | 'gsc' };
  current: { sourceKind: SourceKind | 'rank_tracker' | 'gsc' };
};

export function compareKeywordCohort(
  rows: KeywordRow[],
  sources: CohortSources,
): KeywordCohortComparison {
  const ineligibleReasons: string[] = [];
  if (sources.baseline.sourceKind !== sources.current.sourceKind) {
    // Mixed collection systems never share one cohort.
    ineligibleReasons.push('MIXED_SOURCE_KINDS');
  } else if (sources.current.sourceKind !== 'rank_tracker') {
    // Search Console reports average observed position over an incomplete query
    // universe; it cannot stand in for a fixed tracked-keyword cohort.
    ineligibleReasons.push('NOT_RANK_TRACKER');
  }

  const byKey = new Map<string, { baseline?: KeywordRow; current?: KeywordRow }>();
  for (const row of rows) {
    const key = keywordCohortKey(row);
    const entry = byKey.get(key) ?? {};
    entry[row.period] = row;
    byKey.set(key, entry);
  }

  const movements: KeywordMovement[] = [];
  let excludedUnknown = 0;
  let excludedIneligible = 0;

  for (const [key, pair] of byKey) {
    const { baseline, current } = pair;
    // A missing row is unknown, not unranked, so the member is excluded.
    if (!baseline || !current) {
      excludedUnknown += 1;
      continue;
    }
    const bothTracked = baseline.tracked && current.tracked;
    const bothCommercial = baseline.intent === 'commercial' && current.intent === 'commercial';
    const definitionsAgree =
      baseline.device === current.device &&
      baseline.location === current.location &&
      baseline.searchEngine === current.searchEngine;
    if (!bothTracked || !bothCommercial || !definitionsAgree) {
      excludedIneligible += 1;
      continue;
    }

    const b = baseline.position;
    const c = current.position;
    const transition: KeywordMovement['transition'] =
      b !== null && c !== null
        ? 'ranked'
        : b === null && c !== null
          ? 'entered_ranking'
          : b !== null && c === null
            ? 'left_ranking'
            : 'unranked_both';

    const inBaselineTop10 = b !== null && b <= TOP_10_MAX_POSITION;
    const inCurrentTop10 = c !== null && c <= TOP_10_MAX_POSITION;

    movements.push({
      key,
      keyword: current.keyword,
      device: current.device,
      location: current.location,
      searchEngine: current.searchEngine,
      baselinePosition: b,
      currentPosition: c,
      // Unranked ends produce a text label, never a synthetic rank such as 100.
      movement: b !== null && c !== null ? b - c : null,
      transition,
      enteredTop10: !inBaselineTop10 && inCurrentTop10,
      exitedTop10: inBaselineTop10 && !inCurrentTop10,
    });
  }

  const baselineTop10 = movements.filter(
    (m) => m.baselinePosition !== null && m.baselinePosition <= TOP_10_MAX_POSITION,
  ).length;
  const currentTop10 = movements.filter(
    (m) => m.currentPosition !== null && m.currentPosition <= TOP_10_MAX_POSITION,
  ).length;
  const entered = movements.filter((m) => m.enteredTop10).length;
  const exited = movements.filter((m) => m.exitedTop10).length;

  return {
    fixedCohortEligible: ineligibleReasons.length === 0,
    ineligibleReasons,
    eligibleMembers: movements.length,
    excludedUnknown,
    excludedIneligible,
    baselineTop10,
    currentTop10,
    entered,
    exited,
    // Net change, which is entered minus exited and not the number entering.
    netTop10Change: currentTop10 - baselineTop10,
    movements,
  };
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export type FormComparison = {
  matched: boolean;
  formId: string;
  scope: Scope;
  baselineAttempts: number | null;
  currentAttempts: number | null;
  baselineFailedAttempts: number | null;
  currentFailedAttempts: number | null;
  baselineErrorEvents: number | null;
  currentErrorEvents: number | null;
  baselineFailureRate: number | null;
  currentFailureRate: number | null;
  percentagePointChange: number | null;
  relativeChange: Change;
  /** Raw repeatable events. Context only; it is not a rate. */
  errorEventMultiple: number | null;
};

export function compareSelectedForm(
  rows: FormRow[],
  selected: { formId: string; scope: Scope },
): FormComparison {
  const pick = (period: 'baseline' | 'current') =>
    rows.find(
      (row) =>
        row.period === period && row.formId === selected.formId && row.scope === selected.scope,
    ) ?? null;

  const baseline = pick('baseline');
  const current = pick('current');

  const baselineFailureRate = baseline
    ? rate(baseline.failedAttempts, baseline.attempts)
    : null;
  const currentFailureRate = current ? rate(current.failedAttempts, current.attempts) : null;

  return {
    matched: baseline !== null && current !== null,
    formId: selected.formId,
    scope: selected.scope,
    baselineAttempts: baseline?.attempts ?? null,
    currentAttempts: current?.attempts ?? null,
    baselineFailedAttempts: baseline?.failedAttempts ?? null,
    currentFailedAttempts: current?.failedAttempts ?? null,
    baselineErrorEvents: baseline?.errorEvents ?? null,
    currentErrorEvents: current?.errorEvents ?? null,
    baselineFailureRate,
    currentFailureRate,
    percentagePointChange: percentagePointChange(currentFailureRate, baselineFailureRate),
    relativeChange: relativeChange(currentFailureRate, baselineFailureRate),
    errorEventMultiple: errorEventMultiple(
      current?.errorEvents ?? null,
      baseline?.errorEvents ?? null,
    ),
  };
}
