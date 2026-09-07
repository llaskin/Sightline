import type {
  DatasetName,
  DatasetSource,
  NormalizedReport,
  PeriodSources,
} from './report-schema';

/**
 * Structural comparison checks. Pure: `now` is injected, never read from the
 * wall clock, so every result is reproducible.
 */

export type WindowError = { field: string; code: string; message: string };

export type DatasetFlag = {
  present: boolean;
  /** Eligible to activate a directional rule. Ineligible data stays visible. */
  eligible: boolean;
  reasons: string[];
  caveats: string[];
  timeZone: string | null;
  sourceKind: string | null;
  /** The collection system behind this dataset, used for independence checks. */
  independenceKey: string | null;
};

export type ComparabilityResult = {
  windowErrors: WindowError[];
  baselineWindow: { start: string; end: string };
  currentWindow: { start: string; end: string };
  baselineDayCount: number | null;
  currentDayCount: number | null;
  baseEligible: boolean;
  datasetFlags: Record<DatasetName, DatasetFlag>;
  gaps: string[];
  measurementIssue: boolean;
  measurementReasons: string[];
};

const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 93;
export const MIN_SESSIONS_PER_PERIOD = 100;

/**
 * Days since 1970-01-01 for a civil (calendar) date. Howard Hinnant's algorithm.
 * Works purely on the calendar, so a 23- or 25-hour daylight-saving day still
 * counts as exactly one day.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function toDayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return daysFromCivil(y, m, d);
}

/** Inclusive count of calendar days between two ISO local dates. */
export function inclusiveDayCount(start: string, end: string): number {
  return toDayNumber(end) - toDayNumber(start) + 1;
}

/** Today's calendar date in a given IANA zone, derived from an injected instant. */
export function localDateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function emptyFlag(): DatasetFlag {
  return {
    present: false,
    eligible: false,
    reasons: ['NOT_PROVIDED'],
    caveats: [],
    timeZone: null,
    sourceKind: null,
    independenceKey: null,
  };
}

/**
 * Two sources are independent when the underlying collection system differs.
 * A user-chosen label cannot manufacture independence, so the kind leads the key.
 */
function independenceKey(source: DatasetSource): string {
  return `${source.sourceKind}:${source.scopeKey}`;
}

function describeSources(
  sources: PeriodSources,
  reportTimeZone: string,
): { reasons: string[]; caveats: string[]; timeZone: string | null } {
  const reasons: string[] = [];
  const caveats: string[] = [];

  if (sources.baseline.coverage !== 'complete' || sources.current.coverage !== 'complete') {
    reasons.push('COVERAGE_NOT_COMPLETE');
  }
  if (sources.baseline.definitionVersion !== sources.current.definitionVersion) {
    reasons.push('DEFINITION_MISMATCH');
  }
  if (sources.baseline.scopeKey !== sources.current.scopeKey) {
    reasons.push('SCOPE_MISMATCH');
  }
  if (sources.baseline.sourceKind !== sources.current.sourceKind) {
    reasons.push('SOURCE_KIND_MISMATCH');
  }

  const zone = sources.current.timeZone ?? sources.baseline.timeZone;
  if (sources.baseline.timeZone !== sources.current.timeZone) {
    reasons.push('SOURCE_TIME_ZONE_MISMATCH');
  } else if (zone !== null && zone !== reportTimeZone) {
    // Retained as context. The original zone is never relabelled.
    caveats.push('SOURCE_TIME_ZONE_DIFFERS');
  }

  return { reasons, caveats, timeZone: zone };
}

export function validateComparability(report: NormalizedReport, now: Date): ComparabilityResult {
  const { metadata, datasets, sources } = report;
  const windowErrors: WindowError[] = [];

  const baselineWindow = { start: metadata.baselineStart, end: metadata.baselineEnd };
  const currentWindow = { start: metadata.currentStart, end: metadata.currentEnd };

  const baselineOrdered = metadata.baselineEnd >= metadata.baselineStart;
  const currentOrdered = metadata.currentEnd >= metadata.currentStart;
  if (!baselineOrdered) {
    windowErrors.push({
      field: 'baselineEnd',
      code: 'WINDOW_ORDER',
      message: 'The baseline window ends before it starts',
    });
  }
  if (!currentOrdered) {
    windowErrors.push({
      field: 'currentEnd',
      code: 'WINDOW_ORDER',
      message: 'The current window ends before it starts',
    });
  }

  const baselineDayCount = baselineOrdered
    ? inclusiveDayCount(metadata.baselineStart, metadata.baselineEnd)
    : null;
  const currentDayCount = currentOrdered
    ? inclusiveDayCount(metadata.currentStart, metadata.currentEnd)
    : null;

  for (const [field, days] of [
    ['baselineEnd', baselineDayCount],
    ['currentEnd', currentDayCount],
  ] as const) {
    if (days === null) continue;
    if (days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
      windowErrors.push({
        field,
        code: 'WINDOW_LENGTH',
        message: `Each window must cover ${MIN_WINDOW_DAYS} to ${MAX_WINDOW_DAYS} days; this one covers ${days}`,
      });
    }
  }

  if (
    baselineDayCount !== null &&
    currentDayCount !== null &&
    baselineDayCount !== currentDayCount
  ) {
    windowErrors.push({
      field: 'currentEnd',
      code: 'WINDOW_LENGTH_MISMATCH',
      message: `The windows must be equal in length: baseline ${baselineDayCount} days, current ${currentDayCount} days`,
    });
  }

  // The current window must begin strictly after the baseline window ends.
  if (metadata.currentStart <= metadata.baselineEnd) {
    windowErrors.push({
      field: 'baselineEnd',
      code: 'WINDOW_OVERLAP',
      message: 'The current window must start after the baseline window ends',
    });
  }

  const today = localDateInZone(now, metadata.timeZone);
  if (metadata.currentEnd >= today) {
    windowErrors.push({
      field: 'currentEnd',
      code: 'WINDOW_INCOMPLETE',
      message: `The current window must end before today (${today} in ${metadata.timeZone})`,
    });
  }

  // ---- Measurement issues (specification section 7.2, precedence rule 1) ----
  const measurementReasons: string[] = [];
  if (metadata.trackingStatus === 'known_issue') {
    measurementReasons.push('TRACKING_KNOWN_ISSUE');
  }
  if (sources.organic.baseline.definitionVersion !== sources.organic.current.definitionVersion) {
    measurementReasons.push('ORGANIC_DEFINITION_MISMATCH');
  }
  if (sources.organic.baseline.scopeKey !== sources.organic.current.scopeKey) {
    measurementReasons.push('ORGANIC_SCOPE_MISMATCH');
  }
  for (const period of ['baseline', 'current'] as const) {
    const zone = sources.organic[period].timeZone;
    if (zone !== null && zone !== metadata.timeZone) {
      if (!measurementReasons.includes('ORGANIC_TIME_ZONE_MISMATCH')) {
        measurementReasons.push('ORGANIC_TIME_ZONE_MISMATCH');
      }
    }
  }

  // ---- Per-dataset flags ----
  const datasetFlags = {
    organic: emptyFlag(),
    keywords: emptyFlag(),
    forms: emptyFlag(),
    landingPages: emptyFlag(),
    trafficTrend: emptyFlag(),
    outcomes: emptyFlag(),
  } as Record<DatasetName, DatasetFlag>;

  const names: DatasetName[] = [
    'organic',
    'keywords',
    'forms',
    'landingPages',
    'trafficTrend',
    'outcomes',
  ];

  for (const name of names) {
    const rows = datasets[name];
    const datasetSources = sources[name];
    if (rows === null || datasetSources === null) continue;

    const described = describeSources(datasetSources, metadata.timeZone);
    datasetFlags[name] = {
      present: true,
      eligible: described.reasons.length === 0,
      reasons: described.reasons,
      caveats: described.caveats,
      timeZone: described.timeZone,
      sourceKind: datasetSources.current.sourceKind,
      independenceKey: independenceKey(datasetSources.current),
    };
  }

  // Organic additionally needs enough volume in both periods to carry a direction.
  const organicFlag = datasetFlags.organic;
  const baselineRow = datasets.organic.find((row) => row.period === 'baseline');
  const currentRow = datasets.organic.find((row) => row.period === 'current');
  if (
    !baselineRow ||
    !currentRow ||
    baselineRow.sessions < MIN_SESSIONS_PER_PERIOD ||
    currentRow.sessions < MIN_SESSIONS_PER_PERIOD
  ) {
    organicFlag.reasons.push('MINIMUM_SESSIONS');
    organicFlag.eligible = false;
  }
  if (windowErrors.length > 0) {
    organicFlag.reasons.push('WINDOWS_NOT_COMPARABLE');
    organicFlag.eligible = false;
  }

  const baseEligible = organicFlag.eligible;

  // ---- Gaps: named missing evidence, never silently zero-filled ----
  const gaps: string[] = [];
  if (!datasetFlags.keywords.present) gaps.push('KEYWORDS_NOT_PROVIDED');
  if (!datasetFlags.forms.present) gaps.push('FORMS_NOT_PROVIDED');
  if (!datasetFlags.landingPages.present) gaps.push('LANDING_PAGES_NOT_PROVIDED');
  if (!datasetFlags.trafficTrend.present) gaps.push('TREND_NOT_PROVIDED');
  if (!datasetFlags.outcomes.present) gaps.push('OUTCOMES_NOT_PROVIDED');
  if (baselineRow?.leadSessions === null || currentRow?.leadSessions === null) {
    gaps.push('LEAD_SESSIONS_NOT_PROVIDED');
  }
  if (metadata.trackingStatus === 'unverified') gaps.push('TRACKING_UNVERIFIED');

  return {
    windowErrors,
    baselineWindow,
    currentWindow,
    baselineDayCount,
    currentDayCount,
    baseEligible,
    datasetFlags,
    gaps,
    measurementIssue: measurementReasons.length > 0,
    measurementReasons,
  };
}
