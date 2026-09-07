import type { AnalysisResult, Finding } from '@/domain/analysis-schema';
import { CAVEAT_TEXT } from '@/domain/analyze';
import { COMPLAINT_CATEGORY_LABELS, type ComplaintInput } from '@/domain/complaint-schema';
import { compareKeywordCohort, type KeywordMovement } from '@/domain/metrics';
import type { NormalizedReport } from '@/domain/report-schema';
import {
  formatCount,
  formatDate,
  formatDateRange,
  formatInstant,
  formatMultiple,
  formatRate,
  formatSignedInteger,
  formatWholePercent,
  NOT_PROVIDED,
} from '@/lib/format';

/**
 * A pure mapping from stored snapshots to what the dashboard renders.
 *
 * No analysis happens here and no arithmetic is repeated: every number comes
 * from the saved result, formatted once. Components consume this view model and
 * never compute.
 */

export type MetricKey = 'traffic' | 'keywords' | 'conversion' | 'formErrors';

export type DrawerRow = { label: string; value: string };

export type MetricCard = {
  key: MetricKey;
  title: string;
  value: string;
  detail: string;
  tone: 'positive' | 'negative' | 'neutral';
  eligible: boolean;
  /** Always null in release 1: two summary values cannot make a trend line. */
  sparkline: null;
  drawer: {
    formula: string;
    rows: DrawerRow[];
    sources: string[];
    retrievedAt: string;
    coverage: string;
    canInformComplaint: string;
    caveats: string[];
  };
};

export type ChartPoint = {
  startDate: string;
  endDate: string;
  label: string;
  sessions: number;
  activeUsers: number | null;
};

export type DashboardViewModel = ReturnType<typeof buildDashboardViewModel>;

const HISTORICAL_AFTER_DAYS = 45;

const FOCUS_LABELS: Record<AnalysisResult['investigationFocus'], string> = {
  measurement: 'Measurement',
  search_acquisition: 'Search acquisition',
  post_click: 'Post-click',
  mixed_or_unclear: 'Mixed or unclear',
};

const FOCUS_DESCRIPTIONS: Record<AnalysisResult['investigationFocus'], string> = {
  measurement: 'Figures cannot be compared safely until the measurement problem is resolved.',
  search_acquisition: 'The evidence points at how visitors are arriving from search.',
  post_click: 'The evidence points at what happens after the visitor arrives.',
  mixed_or_unclear:
    'The evidence does not single out one area, either because more than one is affected or because too little is comparable.',
};

const ASSESSMENT_LABELS: Record<AnalysisResult['complaintAssessment'], string> = {
  supported: 'Supported by the supplied records',
  contradicted: 'Not borne out by the supplied records',
  unverified: 'Cannot be checked from this evidence',
};

const STRENGTH_LABELS: Record<AnalysisResult['evidenceStrength'], string> = {
  limited: 'Limited evidence',
  moderate: 'Moderate evidence',
};

function findingBy(result: AnalysisResult, ruleId: string): Finding | undefined {
  return result.findings.find((finding) => finding.ruleId === ruleId);
}

function toneFor(direction: Finding['direction'], goodWhenUp: boolean): MetricCard['tone'] {
  if (direction === 'up') return goodWhenUp ? 'positive' : 'negative';
  if (direction === 'down') return goodWhenUp ? 'negative' : 'positive';
  return 'neutral';
}

function sourceLabels(report: NormalizedReport, dataset: keyof NormalizedReport['sources']): string[] {
  const sources = report.sources[dataset];
  if (!sources) return ['Not provided'];
  const unique = new Set([sources.baseline.sourceLabel, sources.current.sourceLabel]);
  return [...unique];
}

function retrievedAt(report: NormalizedReport, dataset: keyof NormalizedReport['sources']): string {
  const sources = report.sources[dataset];
  if (!sources) return NOT_PROVIDED;
  return formatInstant(sources.current.exportedAt);
}

function coverageOf(report: NormalizedReport, dataset: keyof NormalizedReport['sources']): string {
  const sources = report.sources[dataset];
  if (!sources) return NOT_PROVIDED;
  return sources.baseline.coverage === sources.current.coverage
    ? sources.current.coverage
    : `${sources.baseline.coverage} (baseline), ${sources.current.coverage} (current)`;
}

function renderCaveats(codes: string[]): string[] {
  return codes.map((code) => CAVEAT_TEXT[code] ?? code);
}

export function buildDashboardViewModel(input: {
  report: NormalizedReport;
  complaint: ComplaintInput;
  result: AnalysisResult;
  response: { revision: number; generatedText: string; editedText: string | null } | null;
  clientName: string;
  reportLabel: string;
  now: Date;
}) {
  const { report, complaint, result, response, clientName, reportLabel, now } = input;
  const { metadata } = report;

  const traffic = findingBy(result, 'traffic.change');
  const conversion = findingBy(result, 'conversion.change');
  const rank = findingBy(result, 'rank.top10');
  const form = findingBy(result, 'form.failureRate');

  const periodLabel = formatDateRange(metadata.currentStart, metadata.currentEnd);
  const baselineLabel = formatDateRange(metadata.baselineStart, metadata.baselineEnd);
  const comparisonNote = `${periodLabel} against ${baselineLabel}, organic search, ${metadata.timeZone}`;

  // ---- Metric cards ----
  const metrics: MetricCard[] = [
    {
      key: 'traffic',
      title: 'Organic Traffic',
      value: traffic ? formatWholePercent(traffic.values.percent) : NOT_PROVIDED,
      detail: traffic
        ? `${formatCount(traffic.values.currentSessions)} vs ${formatCount(traffic.values.baselineSessions)}`
        : NOT_PROVIDED,
      tone: toneFor(traffic?.direction ?? 'unknown', true),
      eligible: traffic?.eligible ?? false,
      sparkline: null,
      drawer: {
        formula: '100 x (current sessions - baseline sessions) / baseline sessions',
        rows: [
          { label: 'Current sessions', value: formatCount(traffic?.values.currentSessions) },
          { label: 'Baseline sessions', value: formatCount(traffic?.values.baselineSessions) },
          { label: 'Absolute change', value: formatSignedInteger(traffic?.values.absolute) },
          { label: 'Unrounded change', value: traffic?.values.percent === null || traffic?.values.percent === undefined ? NOT_PROVIDED : `${traffic.values.percent.toFixed(6)}%` },
          { label: 'Comparison', value: comparisonNote },
        ],
        sources: sourceLabels(report, 'organic'),
        retrievedAt: retrievedAt(report, 'organic'),
        coverage: coverageOf(report, 'organic'),
        canInformComplaint: traffic?.eligible
          ? 'Comparable in both periods, so this can carry a direction.'
          : 'Not comparable enough to carry a direction; the raw values are shown for reference.',
        caveats: renderCaveats(traffic?.caveats ?? []),
      },
    },
    {
      key: 'keywords',
      title: 'Keywords in Top 10',
      value: rank ? formatSignedInteger(rank.values.netTop10Change) : NOT_PROVIDED,
      detail: rank
        ? `${formatCount(rank.values.currentTop10)} vs ${formatCount(rank.values.baselineTop10)}`
        : NOT_PROVIDED,
      tone: toneFor(rank?.direction ?? 'unknown', true),
      eligible: rank?.eligible ?? false,
      sparkline: null,
      drawer: {
        formula: 'current top-10 count - baseline top-10 count, within the same tracked cohort',
        rows: [
          { label: 'Entered the top 10', value: formatCount(rank?.values.entered) },
          { label: 'Left the top 10', value: formatCount(rank?.values.exited) },
          { label: 'Members matched in both periods', value: formatCount(rank?.values.eligibleMembers) },
          { label: 'Excluded as unknown', value: formatCount(rank?.values.excludedUnknown) },
          { label: 'Comparison', value: comparisonNote },
        ],
        sources: sourceLabels(report, 'keywords'),
        retrievedAt: retrievedAt(report, 'keywords'),
        coverage: coverageOf(report, 'keywords'),
        canInformComplaint: rank?.eligible
          ? 'A fixed tracked cohort, so a net change here is meaningful.'
          : 'Not an eligible fixed cohort, so this cannot settle a ranking claim.',
        caveats: renderCaveats(rank?.caveats ?? []),
      },
    },
    {
      key: 'conversion',
      title: 'Conversion Rate',
      value: conversion ? formatWholePercent(conversion.values.percent) : NOT_PROVIDED,
      detail:
        conversion && conversion.values.currentRate !== null && conversion.values.baselineRate !== null
          ? `${formatRate(conversion.values.currentRate)} vs ${formatRate(conversion.values.baselineRate)}`
          : NOT_PROVIDED,
      tone: toneFor(conversion?.direction ?? 'unknown', true),
      eligible: conversion?.eligible ?? false,
      sparkline: null,
      drawer: {
        formula: 'lead sessions / sessions, compared as unrounded rates',
        rows: [
          {
            label: 'Current',
            value: `${formatCount(conversion?.values.currentLeadSessions)} lead sessions of ${formatCount(conversion?.values.currentSessions)} sessions`,
          },
          {
            label: 'Baseline',
            value: `${formatCount(conversion?.values.baselineLeadSessions)} lead sessions of ${formatCount(conversion?.values.baselineSessions)} sessions`,
          },
          { label: 'Current rate', value: formatRate(conversion?.values.currentRate, 3) },
          { label: 'Baseline rate', value: formatRate(conversion?.values.baselineRate, 3) },
          {
            label: 'Percentage points',
            value:
              conversion?.values.percentagePointChange === null || conversion?.values.percentagePointChange === undefined
                ? NOT_PROVIDED
                : `${conversion.values.percentagePointChange.toFixed(2)} pp`,
          },
          { label: 'What a lead session is', value: metadata.leadDefinition },
          { label: 'Comparison', value: comparisonNote },
        ],
        sources: sourceLabels(report, 'organic'),
        retrievedAt: retrievedAt(report, 'organic'),
        coverage: coverageOf(report, 'organic'),
        canInformComplaint:
          'This counts sessions containing the configured lead action. It is not a count of leads that reached the client, so it cannot confirm or deny received leads.',
        caveats: renderCaveats(conversion?.caveats ?? []),
      },
    },
    {
      key: 'formErrors',
      title: 'Contact Form Errors',
      value: form ? formatMultiple(form.values.errorEventMultiple) : NOT_PROVIDED,
      detail: form
        ? `${formatCount(form.values.currentErrorEvents)} vs ${formatCount(form.values.baselineErrorEvents)}`
        : NOT_PROVIDED,
      tone: form && form.direction === 'down' ? 'negative' : 'neutral',
      eligible: form?.eligible ?? false,
      sparkline: null,
      drawer: {
        formula: 'error events: current / baseline. Failure rate: failed attempts / attempts.',
        rows: [
          { label: 'Current failure rate', value: formatRate(form?.values.currentFailureRate, 3) },
          { label: 'Baseline failure rate', value: formatRate(form?.values.baselineFailureRate, 3) },
          {
            label: 'Percentage points',
            value:
              form?.values.percentagePointChange === null || form?.values.percentagePointChange === undefined
                ? NOT_PROVIDED
                : `${form.values.percentagePointChange.toFixed(2)} pp`,
          },
          {
            label: 'Current attempts',
            value: `${formatCount(form?.values.currentFailedAttempts)} failed of ${formatCount(form?.values.currentAttempts)}`,
          },
          {
            label: 'Baseline attempts',
            value: `${formatCount(form?.values.baselineFailedAttempts)} failed of ${formatCount(form?.values.baselineAttempts)}`,
          },
          {
            label: 'Scope',
            value: report.selectedForm
              ? `form "${report.selectedForm.formId}", ${report.selectedForm.scope === 'organic_search' ? 'organic search' : 'all channels'}`
              : NOT_PROVIDED,
          },
        ],
        sources: sourceLabels(report, 'forms'),
        retrievedAt: retrievedAt(report, 'forms'),
        coverage: coverageOf(report, 'forms'),
        canInformComplaint:
          'Error events can repeat for one attempt, so this multiple is context. Only the unique failure rate can activate a post-click finding.',
        caveats: renderCaveats(form?.caveats ?? []),
      },
    },
  ];

  // ---- Chart ----
  const trend = report.datasets.trafficTrend ?? [];
  const sorted = [...trend].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const series: ChartPoint[] = sorted.map((row) => ({
    startDate: row.startDate,
    endDate: row.endDate,
    label: formatDate(row.endDate),
    sessions: row.sessions,
    activeUsers: row.activeUsers,
  }));

  const chart = {
    series,
    emptyReason: series.length === 0 ? 'Trend data not provided' : null,
    granularity: report.trendGranularity,
    rangeOptions: [
      { value: 'current', label: 'Current period', disabled: series.length < 1 },
      { value: 'last3', label: 'Last 3 supplied periods', disabled: series.length < 3 },
      { value: 'last6', label: 'Last 6 supplied periods', disabled: series.length < 6 },
    ],
    usersNote:
      'Each users figure is an aggregate supplied for that exact bucket. Daily unique users are never summed into a longer total.',
    // An accessible equivalent to the line chart.
    table: series.map((point) => ({
      period: `${formatDate(point.startDate)} - ${formatDate(point.endDate)}`,
      sessions: formatCount(point.sessions),
      activeUsers: formatCount(point.activeUsers),
    })),
  };

  // ---- Tables ----
  const landingPages = report.datasets.landingPages ?? [];
  const byPath = new Map<string, { path: string; current: number | null; baseline: number | null }>();
  for (const row of landingPages) {
    const entry = byPath.get(row.path) ?? { path: row.path, current: null, baseline: null };
    if (row.period === 'current') entry.current = row.sessions;
    else entry.baseline = row.sessions;
    byPath.set(row.path, entry);
  }
  const allPages = [...byPath.values()]
    .map((entry) => ({
      path: entry.path,
      sessions: entry.current,
      baselineSessions: entry.baseline,
      change:
        entry.current === null || entry.baseline === null || entry.baseline === 0
          ? null
          : ((entry.current - entry.baseline) / entry.baseline) * 100,
    }))
    .sort((a, b) => (b.sessions ?? -1) - (a.sessions ?? -1));

  const pages = {
    rows: allPages.slice(0, 5),
    allRows: allPages,
    isSubset: true,
    caption:
      'Organic landing-page sessions for the pages supplied. These are landing-page sessions, not page views, and this is a labelled subset rather than all site traffic.',
  };

  const keywordSources = report.sources.keywords;
  const cohort = report.datasets.keywords && keywordSources
    ? compareKeywordCohort(report.datasets.keywords, {
        baseline: { sourceKind: keywordSources.baseline.sourceKind },
        current: { sourceKind: keywordSources.current.sourceKind },
      })
    : null;

  const movementRows = (cohort?.movements ?? []).map((movement) => ({
    keyword: movement.keyword,
    baselinePosition: movement.baselinePosition,
    currentPosition: movement.currentPosition,
    movement: movement.movement,
    movementLabel: movementLabel(movement),
  }));
  const improvements = [...movementRows].sort((a, b) => (b.movement ?? -Infinity) - (a.movement ?? -Infinity));

  const isGsc = keywordSources?.current.sourceKind === 'gsc';
  const keywords = {
    rows: improvements.slice(0, 5),
    allRows: movementRows,
    caption: isGsc
      ? 'Observed queries and their average position from Search Console. Search Console reports an average over an incomplete set of queries, so this is descriptive context and not a fixed ranking comparison.'
      : 'The same tracked commercial keywords in both periods. A positive movement means the position improved.',
  };

  // ---- Panels ----
  const assessment = {
    statusLabel: ASSESSMENT_LABELS[result.complaintAssessment],
    status: result.complaintAssessment,
    reason: result.assessmentReason,
    headline: result.headline,
    focus: result.investigationFocus,
    focusLabel: FOCUS_LABELS[result.investigationFocus],
    focusDescription: FOCUS_DESCRIPTIONS[result.investigationFocus],
    /** Four labelled categories, positioned by diagnosis. Never a percentage. */
    focusOptions: (
      ['measurement', 'search_acquisition', 'post_click', 'mixed_or_unclear'] as const
    ).map((value) => ({
      value,
      label: FOCUS_LABELS[value],
      selected: value === result.investigationFocus,
    })),
    strength: result.evidenceStrength,
    strengthLabel: STRENGTH_LABELS[result.evidenceStrength],
    strengthReasons: result.strengthReasons,
    periodAlignment: result.periodAlignment,
  };

  const diagnosis = {
    // Rule generated in release 1, so it is never presented as a model's opinion.
    title: 'Evidence diagnosis',
    headline: result.headline,
    findings: result.findings.map((finding) => ({
      id: finding.id,
      ruleId: finding.ruleId,
      text: finding.text,
      direction: finding.direction,
      eligible: finding.eligible,
      unit: finding.unit,
      caveats: renderCaveats(finding.caveats),
      sources: finding.sources,
      values: finding.values,
    })),
    gaps: result.gaps,
    nextChecks: result.nextChecks,
  };

  const currentEndDayNumber = Date.parse(`${metadata.currentEnd}T00:00:00Z`);
  const daysSinceEnd = Math.floor((now.getTime() - currentEndDayNumber) / 86_400_000);

  return {
    clientName,
    reportLabel,
    periodLabel,
    baselineLabel,
    comparisonNote,
    metrics,
    chart,
    pages,
    keywords,
    assessment,
    diagnosis,
    complaint: {
      originalText: complaint.originalText,
      categoryLabel: COMPLAINT_CATEGORY_LABELS[complaint.category],
      scopeLabel: complaint.scope === 'organic_search' ? 'Organic search' : 'All channels',
      receivedLabel: formatInstant(complaint.receivedAt),
      periodLabel: formatDateRange(complaint.periodStart, complaint.periodEnd),
    },
    response: response
      ? {
          revision: response.revision,
          text: response.editedText ?? response.generatedText,
          generatedText: response.generatedText,
          isEdited: response.editedText !== null,
          // Edited text is never described as engine verified.
          label: response.editedText !== null ? 'Agency-edited draft' : 'Generated draft',
        }
      : null,
    footer: {
      reportPeriod: periodLabel,
      sourceFreshness: `Sources exported ${retrievedAt(report, 'organic')}`,
      trackingStatus: metadata.trackingStatus,
      trackingNote: metadata.trackingEvidenceNote,
      // A freshness cue, not a reason to invalidate a complete comparison.
      isHistorical: daysSinceEnd > HISTORICAL_AFTER_DAYS,
      historicalNote: `This report covers ${periodLabel}. It is shown as recorded and has not been recomputed.`,
    },
  };
}

function movementLabel(movement: KeywordMovement): string {
  switch (movement.transition) {
    case 'ranked':
      return movement.movement === null
        ? NOT_PROVIDED
        : `${formatSignedInteger(movement.movement)} positions`;
    case 'entered_ranking':
      return 'Entered the ranked set';
    case 'left_ranking':
      return 'Left the ranked set';
    case 'unranked_both':
      return 'Unranked in both periods';
  }
}
