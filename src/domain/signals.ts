import type { ComparabilityResult } from './comparability';
import { MIN_SESSIONS_PER_PERIOD } from './comparability';
import {
  compareKeywordCohort,
  compareSelectedForm,
  rate,
  relativeChange,
  type FormComparison,
  type KeywordCohortComparison,
} from './metrics';
import type { Change, Direction } from './analysis-schema';
import type { NormalizedReport } from './report-schema';

/**
 * Threshold and eligibility rules from specification section 7.2.
 *
 * These are product heuristics for deciding where to look. They are not
 * statistical significance tests, and nothing here establishes causation.
 */

export const THRESHOLDS = {
  minSessionsPerPeriod: MIN_SESSIONS_PER_PERIOD,
  trafficRelativePercent: 10,
  minBaselineLeadSessions: 20,
  conversionRelativePercent: 20,
  minCohortMembers: 20,
  netTop10Change: 5,
  minFormAttempts: 100,
  formPercentagePoints: 2,
  formRelativePercent: 50,
  formZeroBaselineMinFailures: 5,
} as const;

export type Signal = {
  eligible: boolean;
  direction: Direction;
  /** Why the signal cannot activate a rule. The values stay readable regardless. */
  reasons: string[];
  caveats: string[];
  values: Record<string, number | null>;
  change: Change;
};

export type Signals = {
  traffic: Signal;
  conversion: Signal;
  rank: Signal;
  form: Signal;
  cohort: KeywordCohortComparison | null;
  formComparison: FormComparison | null;
  acquisitionConcern: boolean;
  postClickConcern: boolean;
  measurementIssue: boolean;
  baseEligible: boolean;
};

function directionFromPercent(change: Change, threshold: number): Direction {
  if (change.kind !== 'relative') {
    // A collapse to zero from a positive baseline is a real -100% decline.
    return change.kind === 'unavailable' ? 'unknown' : 'flat';
  }
  if (change.percent <= -threshold) return 'down';
  if (change.percent >= threshold) return 'up';
  return 'flat';
}

export function deriveSignals(report: NormalizedReport, quality: ComparabilityResult): Signals {
  const baseline = report.datasets.organic.find((row) => row.period === 'baseline')!;
  const current = report.datasets.organic.find((row) => row.period === 'current')!;

  // ---- Traffic ----
  const trafficChange = relativeChange(current.sessions, baseline.sessions);
  const trafficReasons = quality.baseEligible ? [] : [...quality.datasetFlags.organic.reasons];
  const traffic: Signal = {
    eligible: quality.baseEligible,
    direction: quality.baseEligible ? directionFromPercent(trafficChange, THRESHOLDS.trafficRelativePercent) : 'unknown',
    reasons: trafficReasons,
    caveats: quality.datasetFlags.organic.caveats,
    values: {
      baselineSessions: baseline.sessions,
      currentSessions: current.sessions,
      percent: trafficChange.kind === 'relative' ? trafficChange.percent : null,
      absolute: trafficChange.kind === 'unavailable' ? null : trafficChange.absolute,
    },
    change: trafficChange,
  };

  // ---- Conversion ----
  const baselineRate = rate(baseline.leadSessions, baseline.sessions);
  const currentRate = rate(current.leadSessions, current.sessions);
  const conversionChange = relativeChange(currentRate, baselineRate);
  const conversionReasons: string[] = [...trafficReasons];
  if (baseline.leadSessions === null || current.leadSessions === null) {
    conversionReasons.push('LEAD_SESSIONS_NOT_PROVIDED');
  } else if (baseline.leadSessions < THRESHOLDS.minBaselineLeadSessions) {
    conversionReasons.push('MINIMUM_BASELINE_LEAD_SESSIONS');
  }
  // A complete collapse to zero stays eligible: suppressing it behind a
  // minimum-current-leads floor would hide the most serious possible outcome.
  if (
    current.leadSessions === 0 &&
    current.sessions >= THRESHOLDS.minSessionsPerPeriod &&
    quality.measurementIssue
  ) {
    conversionReasons.push('MEASUREMENT_ISSUE_COULD_EXPLAIN_ZERO');
  }
  const conversionEligible = conversionReasons.length === 0;
  const conversion: Signal = {
    eligible: conversionEligible,
    direction: conversionEligible
      ? directionFromPercent(conversionChange, THRESHOLDS.conversionRelativePercent)
      : 'unknown',
    reasons: conversionReasons,
    caveats: quality.datasetFlags.organic.caveats,
    values: {
      baselineLeadSessions: baseline.leadSessions,
      currentLeadSessions: current.leadSessions,
      baselineRate,
      currentRate,
      percent: conversionChange.kind === 'relative' ? conversionChange.percent : null,
      percentagePointChange:
        currentRate === null || baselineRate === null ? null : (currentRate - baselineRate) * 100,
    },
    change: conversionChange,
  };

  // ---- Fixed-cohort rank ----
  const keywordRows = report.datasets.keywords;
  const keywordSources = report.sources.keywords;
  let cohortComparison: KeywordCohortComparison | null = null;
  const rankReasons: string[] = [];
  if (!keywordRows || !keywordSources) {
    rankReasons.push('NOT_PROVIDED');
  } else {
    cohortComparison = compareKeywordCohort(keywordRows, {
      baseline: { sourceKind: keywordSources.baseline.sourceKind },
      current: { sourceKind: keywordSources.current.sourceKind },
    });
    rankReasons.push(...cohortComparison.ineligibleReasons);
    rankReasons.push(...quality.datasetFlags.keywords.reasons);
    if (cohortComparison.eligibleMembers < THRESHOLDS.minCohortMembers) {
      rankReasons.push('MINIMUM_COHORT_MEMBERS');
    }
  }
  const rankEligible = rankReasons.length === 0;
  const netChange = cohortComparison?.netTop10Change ?? null;
  const rank: Signal = {
    eligible: rankEligible,
    direction:
      rankEligible && netChange !== null
        ? netChange <= -THRESHOLDS.netTop10Change
          ? 'down'
          : netChange >= THRESHOLDS.netTop10Change
            ? 'up'
            : 'flat'
        : 'unknown',
    reasons: rankReasons,
    caveats: quality.datasetFlags.keywords.caveats,
    values: {
      baselineTop10: cohortComparison?.baselineTop10 ?? null,
      currentTop10: cohortComparison?.currentTop10 ?? null,
      entered: cohortComparison?.entered ?? null,
      exited: cohortComparison?.exited ?? null,
      netTop10Change: netChange,
      eligibleMembers: cohortComparison?.eligibleMembers ?? null,
      excludedUnknown: cohortComparison?.excludedUnknown ?? null,
    },
    change: { kind: 'unavailable', reason: 'Rank movement is reported as a signed count' },
  };

  // ---- Selected form ----
  const formRows = report.datasets.forms;
  const selected = report.selectedForm;
  let formComparison: FormComparison | null = null;
  const formReasons: string[] = [];
  const formCaveats: string[] = [...quality.datasetFlags.forms.caveats];
  if (!formRows || !selected || !report.sources.forms) {
    formReasons.push('NOT_PROVIDED');
  } else {
    formComparison = compareSelectedForm(formRows, selected);
    formReasons.push(...quality.datasetFlags.forms.reasons);
    if (!formComparison.matched) formReasons.push('SELECTED_FORM_NOT_MATCHED');
    if (!report.formDefinitionAcknowledged) formReasons.push('DEFINITION_NOT_ACKNOWLEDGED');
    if (
      formComparison.baselineAttempts === null ||
      formComparison.currentAttempts === null ||
      formComparison.baselineAttempts < THRESHOLDS.minFormAttempts ||
      formComparison.currentAttempts < THRESHOLDS.minFormAttempts
    ) {
      formReasons.push('MINIMUM_FORM_ATTEMPTS');
    }
    if (
      formComparison.baselineFailedAttempts === null ||
      formComparison.currentFailedAttempts === null
    ) {
      formReasons.push('FAILED_ATTEMPTS_NOT_PROVIDED');
    }
    // All-channel evidence against an organic report is indirect corroboration
    // only; it can never activate or strengthen an organic post-click rule.
    if (selected.scope !== 'organic_search') {
      formCaveats.push('INDIRECT_ALL_CHANNEL_SCOPE');
    }
    const sourceZone = quality.datasetFlags.forms.timeZone;
    if (sourceZone !== null && sourceZone !== report.metadata.timeZone) {
      formCaveats.push('INDIRECT_TIME_ZONE_DIFFERS');
    }
  }

  const formEligible = formReasons.length === 0;
  const formDegraded = formEligible && isFormDegraded(formComparison);
  const form: Signal = {
    eligible: formEligible,
    direction: formEligible ? (formDegraded ? 'down' : 'flat') : 'unknown',
    reasons: formReasons,
    caveats: formCaveats,
    values: {
      baselineAttempts: formComparison?.baselineAttempts ?? null,
      currentAttempts: formComparison?.currentAttempts ?? null,
      baselineFailedAttempts: formComparison?.baselineFailedAttempts ?? null,
      currentFailedAttempts: formComparison?.currentFailedAttempts ?? null,
      baselineFailureRate: formComparison?.baselineFailureRate ?? null,
      currentFailureRate: formComparison?.currentFailureRate ?? null,
      percentagePointChange: formComparison?.percentagePointChange ?? null,
      percent:
        formComparison?.relativeChange.kind === 'relative'
          ? formComparison.relativeChange.percent
          : null,
      baselineErrorEvents: formComparison?.baselineErrorEvents ?? null,
      currentErrorEvents: formComparison?.currentErrorEvents ?? null,
      errorEventMultiple: formComparison?.errorEventMultiple ?? null,
    },
    change: formComparison?.relativeChange ?? { kind: 'unavailable', reason: 'No form evidence' },
  };

  // Only organic-scoped form degradation contributes to a post-click concern.
  const eligibleOrganicFormDegradation =
    formDegraded && selected?.scope === 'organic_search' && !formCaveats.includes('INDIRECT_TIME_ZONE_DIFFERS');

  const acquisitionConcern =
    (traffic.eligible && traffic.direction === 'down') || (rank.eligible && rank.direction === 'down');
  const postClickConcern =
    (conversion.eligible && conversion.direction === 'down') || eligibleOrganicFormDegradation;

  return {
    traffic,
    conversion,
    rank,
    form,
    cohort: cohortComparison,
    formComparison,
    acquisitionConcern,
    postClickConcern,
    measurementIssue: quality.measurementIssue,
    baseEligible: quality.baseEligible,
  };
}

/**
 * Degradation needs both a meaningful absolute rise and a meaningful relative
 * one, so a tiny rate moving from 0.1% to 0.2% does not count as a failure.
 */
function isFormDegraded(comparison: FormComparison | null): boolean {
  if (!comparison) return false;
  const { baselineFailureRate, currentFailureRate, currentFailedAttempts } = comparison;
  if (baselineFailureRate === null || currentFailureRate === null) return false;

  const pointRise = (currentFailureRate - baselineFailureRate) * 100;
  if (pointRise < THRESHOLDS.formPercentagePoints) return false;

  if (baselineFailureRate === 0) {
    // A relative change from zero is undefined, so an absolute floor applies.
    return (currentFailedAttempts ?? 0) >= THRESHOLDS.formZeroBaselineMinFailures;
  }

  const relativePercent = ((currentFailureRate - baselineFailureRate) / baselineFailureRate) * 100;
  return relativePercent >= THRESHOLDS.formRelativePercent;
}

/** The ordered decision table from specification section 7.3. */
export function chooseDiagnosis(signals: {
  measurementIssue: boolean;
  baseEligible: boolean;
  acquisitionConcern: boolean;
  postClickConcern: boolean;
}): 'measurement_issue' | 'insufficient_evidence' | 'mixed' | 'search_acquisition' | 'post_click' | 'no_clear_issue' {
  if (signals.measurementIssue) return 'measurement_issue';
  if (!signals.baseEligible) return 'insufficient_evidence';
  if (signals.acquisitionConcern && signals.postClickConcern) return 'mixed';
  if (signals.acquisitionConcern) return 'search_acquisition';
  if (signals.postClickConcern) return 'post_click';
  return 'no_clear_issue';
}
