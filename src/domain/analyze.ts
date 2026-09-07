import {
  DIAGNOSIS_FOCUS,
  DIAGNOSIS_HEADLINES,
  RESULT_SCHEMA_VERSION,
  type AnalysisResult,
  type EvidenceRef,
  type EvidenceStrength,
  type Finding,
} from './analysis-schema';
import type { ComplaintInput } from './complaint-schema';
import { validateComparability } from './comparability';
import { assessComplaint } from './assess-complaint';
import { buildNextChecks } from './recommendations';
import { chooseDiagnosis, deriveSignals, THRESHOLDS, type Signals } from './signals';
import type { NormalizedReport } from './report-schema';
import { formatDateRange } from '@/lib/format';

/**
 * The pure analysis engine. No database, network, environment variable, wall
 * clock or language model participates. Given the same report, complaint and
 * `now`, it always returns the same result.
 */

export type AnalyzeOptions = { now: Date; ruleVersion: '1.0.0' };

/** Human-readable text for every gap and caveat code the engine can emit. */
export const GAP_TEXT: Record<string, string> = {
  KEYWORDS_NOT_PROVIDED: 'No keyword data was supplied, so ranking movement cannot be examined.',
  FORMS_NOT_PROVIDED:
    'No form backend data was supplied, so submission failures cannot be examined. A traffic report cannot supply this.',
  LANDING_PAGES_NOT_PROVIDED: 'No landing-page data was supplied.',
  TREND_NOT_PROVIDED: 'Trend data not provided, so no trend line is shown.',
  OUTCOMES_NOT_PROVIDED:
    'No received-lead, qualified-lead or revenue records were supplied, so business outcomes are unverified.',
  LEAD_SESSIONS_NOT_PROVIDED: 'Lead-session counts were not supplied for both periods.',
  TRACKING_UNVERIFIED:
    'Tracking has not been verified for this report, so every figure below carries that uncertainty.',
  COVERAGE_NOT_COMPLETE: 'A source did not cover the full period, so it cannot carry a direction.',
  MINIMUM_SESSIONS: `A period has fewer than ${THRESHOLDS.minSessionsPerPeriod} sessions, which is too few to read a direction from.`,
  WINDOWS_NOT_COMPARABLE: 'The two reporting windows are not comparable.',
  MEASUREMENT_UNRESOLVED:
    'Lead delivery and business outcomes have not been verified against an independent record.',
};

export const CAVEAT_TEXT: Record<string, string> = {
  SOURCE_TIME_ZONE_DIFFERS:
    'This source records dates in a different time zone from the report, so its window is not exactly the same days.',
  INDIRECT_ALL_CHANNEL_SCOPE:
    'This form evidence covers all channels, not organic search alone, so it is indirect corroboration only.',
  INDIRECT_TIME_ZONE_DIFFERS:
    'This form evidence uses a different time zone from the report, so it is indirect corroboration only.',
};

function ref(dataset: string, period: 'baseline' | 'current' | null, rowKey: string): EvidenceRef {
  return { dataset, period, rowKey };
}

export function analyzeReport(
  report: NormalizedReport,
  complaint: ComplaintInput,
  options: AnalyzeOptions,
): AnalysisResult {
  const quality = validateComparability(report, options.now);
  const signals = deriveSignals(report, quality);

  const diagnosis = chooseDiagnosis({
    measurementIssue: signals.measurementIssue,
    baseEligible: signals.baseEligible,
    acquisitionConcern: signals.acquisitionConcern,
    postClickConcern: signals.postClickConcern,
  });

  const findings = buildFindings(report, signals, quality.measurementReasons, diagnosis);
  const { strength, reasons } = deriveStrength(report, signals, diagnosis);
  const assessment = assessComplaint(report, complaint, quality, signals);

  const gaps = quality.gaps.map((code) => GAP_TEXT[code] ?? code);
  if (diagnosis === 'no_clear_issue') {
    // Rising sessions and stable ranks are not proof that leads arrived.
    gaps.push(GAP_TEXT.MEASUREMENT_UNRESOLVED);
  }

  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    ruleVersion: options.ruleVersion,
    diagnosis,
    headline: DIAGNOSIS_HEADLINES[diagnosis],
    complaintAssessment: assessment.assessment,
    assessmentReason: assessment.reason,
    evidenceStrength: strength,
    strengthReasons: reasons,
    investigationFocus: DIAGNOSIS_FOCUS[diagnosis],
    findings,
    gaps,
    nextChecks: buildNextChecks(diagnosis, findings),
    periodAlignment: assessment.periodAlignment,
  };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function buildFindings(
  report: NormalizedReport,
  signals: Signals,
  measurementReasons: string[],
  diagnosis: string,
): Finding[] {
  const findings: Finding[] = [];
  const window = formatDateRange(report.metadata.currentStart, report.metadata.currentEnd);
  const baselineWindow = formatDateRange(
    report.metadata.baselineStart,
    report.metadata.baselineEnd,
  );
  // Dates are stated in ISO form too, so a finding is never ambiguous about
  // which period it describes.
  const scopeSuffix =
    ` Compared ${report.metadata.currentStart} to ${report.metadata.currentEnd} against ` +
    `${report.metadata.baselineStart} to ${report.metadata.baselineEnd} (${window} against ${baselineWindow}), ` +
    `organic search only, in ${report.metadata.timeZone}.`;

  // Findings store stable caveat codes; CAVEAT_TEXT renders them at the view layer.
  const toCaveats = (codes: string[]) => [...codes];

  // ---- Measurement ----
  if (measurementReasons.length > 0) {
    findings.push({
      id: 'finding-measurement',
      ruleId: 'quality.measurement',
      statementKey: 'quality.measurement',
      text:
        'The two periods cannot be compared safely yet: ' +
        measurementReasons.map((code) => MEASUREMENT_TEXT[code] ?? code).join(' ') +
        ' Resolve this before attributing the change to anything.',
      direction: 'unknown',
      values: {},
      unit: 'none',
      sources: [ref('organic', null, 'source-metadata')],
      eligible: false,
      caveats: [],
    });
  }

  // ---- Traffic ----
  const traffic = signals.traffic;
  findings.push({
    id: 'finding-traffic',
    ruleId: 'traffic.change',
    statementKey: `traffic.${traffic.direction}`,
    text:
      `Organic sessions moved from ${traffic.values.baselineSessions} to ${traffic.values.currentSessions}.` +
      (traffic.eligible ? '' : ' This figure is shown for reference and does not carry a direction here.') +
      scopeSuffix,
    direction: traffic.direction,
    values: traffic.values,
    unit: 'sessions',
    sources: [ref('organic', 'baseline', 'sessions'), ref('organic', 'current', 'sessions')],
    eligible: traffic.eligible,
    caveats: toCaveats(traffic.caveats),
  });

  // ---- Conversion ----
  const conversion = signals.conversion;
  const rateText =
    conversion.values.baselineRate === null || conversion.values.currentRate === null
      ? 'The tracked lead-session rate could not be calculated for both periods.'
      : `The tracked lead-session rate moved from ${(conversion.values.baselineRate * 100).toFixed(3)}% ` +
        `(${conversion.values.baselineLeadSessions} of ${conversion.values.baselineSessions ?? traffic.values.baselineSessions}) to ` +
        `${(conversion.values.currentRate * 100).toFixed(3)}% ` +
        `(${conversion.values.currentLeadSessions} of ${traffic.values.currentSessions}).`;
  findings.push({
    id: 'finding-conversion',
    ruleId: 'conversion.change',
    statementKey: `conversion.${conversion.direction}`,
    text:
      `${rateText} A lead session is a session containing the configured lead action; it is not a count of leads that reached the client.` +
      (conversion.eligible ? '' : ' This figure does not carry a direction here.'),
    direction: conversion.direction,
    values: { ...conversion.values, baselineSessions: traffic.values.baselineSessions, currentSessions: traffic.values.currentSessions },
    unit: 'rate',
    sources: [
      ref('organic', 'baseline', 'lead_sessions'),
      ref('organic', 'current', 'lead_sessions'),
    ],
    eligible: conversion.eligible,
    caveats: toCaveats(conversion.caveats),
  });

  // ---- Rank cohort ----
  if (report.datasets.keywords) {
    const rank = signals.rank;
    const isGsc = report.sources.keywords?.current.sourceKind === 'gsc';
    const label = isGsc
      ? `Observed queries averaging positions 1 to 10 moved from ${rank.values.baselineTop10} to ${rank.values.currentTop10}. ` +
        'Search Console reports an average observed position over an incomplete set of queries, so this is descriptive context and not a fixed ranking comparison.'
      : `Within the tracked commercial keyword cohort, the number in the top 10 moved from ${rank.values.baselineTop10} to ${rank.values.currentTop10}, ` +
        `a net change of ${(rank.values.netTop10Change ?? 0) >= 0 ? '+' : ''}${rank.values.netTop10Change}. ` +
        `${rank.values.entered} members entered the top 10 and ${rank.values.exited} left it, across ${rank.values.eligibleMembers} members matched in both periods. ` +
        'These are the same tracked terms in both periods, not newly discovered queries.';
    findings.push({
      id: 'finding-rank',
      ruleId: 'rank.top10',
      statementKey: `rank.${rank.direction}`,
      text: label + (rank.eligible ? '' : ' This does not carry a direction here.'),
      direction: rank.direction,
      values: rank.values,
      unit: 'keywords',
      sources: [ref('keywords', 'baseline', 'cohort'), ref('keywords', 'current', 'cohort')],
      eligible: rank.eligible,
      caveats: toCaveats(rank.caveats),
    });
  }

  // ---- Selected form ----
  if (report.datasets.forms && report.selectedForm) {
    const form = signals.form;
    const rateSentence =
      form.values.baselineFailureRate === null || form.values.currentFailureRate === null
        ? 'The unique failure rate could not be calculated, because attempt counts were not supplied.'
        : `The unique failure rate for form "${report.selectedForm.formId}" moved from ` +
          `${(form.values.baselineFailureRate * 100).toFixed(3)}% (${form.values.baselineFailedAttempts} of ${form.values.baselineAttempts}) to ` +
          `${(form.values.currentFailureRate * 100).toFixed(3)}% (${form.values.currentFailedAttempts} of ${form.values.currentAttempts}).`;
    const eventSentence =
      form.values.errorEventMultiple === null
        ? `Error events moved from ${form.values.baselineErrorEvents} to ${form.values.currentErrorEvents}.`
        : `Error events moved from ${form.values.baselineErrorEvents} to ${form.values.currentErrorEvents}, a multiple of ${form.values.errorEventMultiple.toFixed(3)}. ` +
          'Error events can repeat for a single attempt, so this count is context and not a failure rate.';
    findings.push({
      id: 'finding-form',
      ruleId: 'form.failureRate',
      statementKey: `form.${form.direction}`,
      text: `${rateSentence} ${eventSentence}`,
      direction: form.direction,
      values: form.values,
      unit: 'rate',
      sources: [ref('forms', 'baseline', report.selectedForm.formId), ref('forms', 'current', report.selectedForm.formId)],
      eligible: form.eligible,
      caveats: toCaveats(form.caveats),
    });
  }

  // ---- Outcomes ----
  if (report.datasets.outcomes) {
    for (const row of report.datasets.outcomes) {
      findings.push({
        id: `finding-outcome-${row.metric}-${row.scope}`,
        ruleId: `outcome.${row.metric}`,
        statementKey: `outcome.${row.metric}`,
        text:
          `${row.sourceLabel} reports ${row.metric.replace(/_/g, ' ')} of ` +
          `${row.baselineValue ?? 'unknown'} in the baseline period and ${row.currentValue ?? 'unknown'} in the current period ` +
          `(${row.scope === 'organic_search' ? 'organic search' : 'all channels'}). Attribution: ${row.attributionNote}`,
        direction:
          row.baselineValue === null || row.currentValue === null
            ? 'unknown'
            : row.currentValue < row.baselineValue
              ? 'down'
              : row.currentValue > row.baselineValue
                ? 'up'
                : 'flat',
        values: { baselineValue: row.baselineValue, currentValue: row.currentValue },
        unit: row.metric === 'revenue' ? `currency-minor-${row.currency}` : 'count',
        sources: [ref('outcomes', null, row.metric)],
        eligible: row.coverage === 'complete',
        caveats: [],
      });
    }
  }

  // ---- Honesty about what remains unexplained ----
  if (diagnosis === 'no_clear_issue') {
    findings.push({
      id: 'finding-unverified-delivery',
      ruleId: 'quality.unverifiedDelivery',
      statementKey: 'quality.unverifiedDelivery',
      text:
        'Lead delivery and business outcomes have not been verified against an independent record. ' +
        'Rising sessions and stable rankings do not establish that the traffic is more relevant, or that any lead reached the client. ' +
        'Lead quality, revenue, device and country mix, seasonality, content intent and search engine changes may all remain unexplained by this report.',
      direction: 'unknown',
      values: {},
      unit: 'none',
      sources: [ref('organic', null, 'coverage')],
      eligible: false,
      caveats: [],
    });
  }

  return findings;
}

const MEASUREMENT_TEXT: Record<string, string> = {
  TRACKING_KNOWN_ISSUE: 'A known tracking problem was recorded for this report.',
  ORGANIC_DEFINITION_MISMATCH:
    'The two periods use different measurement definitions for the required organic data.',
  ORGANIC_SCOPE_MISMATCH: 'The two periods cover different property or filter scopes.',
  ORGANIC_TIME_ZONE_MISMATCH:
    'The organic source reports dates in a different time zone from the report.',
};

// ---------------------------------------------------------------------------
// Evidence strength
// ---------------------------------------------------------------------------

/**
 * Strength is moderate only when tracking is verified, the base acquisition
 * signal is eligible, and an *independent collection system* corroborates the
 * selected diagnosis. Two metrics from one analytics export are one source, so
 * they can never reach moderate on their own.
 */
function deriveStrength(
  report: NormalizedReport,
  signals: Signals,
  diagnosis: string,
): { strength: EvidenceStrength; reasons: string[] } {
  const reasons: string[] = [];

  if (report.metadata.trackingStatus !== 'verified') {
    reasons.push(
      `Tracking is recorded as ${report.metadata.trackingStatus}, which caps evidence strength at limited.`,
    );
    return { strength: 'limited', reasons };
  }
  if (diagnosis === 'no_clear_issue' || diagnosis === 'measurement_issue' || diagnosis === 'insufficient_evidence') {
    reasons.push('This outcome does not select a corroborated investigation area, so strength stays limited.');
    return { strength: 'limited', reasons };
  }
  if (!signals.baseEligible) {
    reasons.push('The base acquisition signal is not eligible, so strength stays limited.');
    return { strength: 'limited', reasons };
  }

  const organicIndependence = `${report.sources.organic.current.sourceKind}`;

  // A rank-tracker cohort that deteriorated, from a system other than analytics.
  const rankCorroborates =
    signals.rank.eligible &&
    signals.rank.direction === 'down' &&
    report.sources.keywords !== null &&
    report.sources.keywords.current.sourceKind !== organicIndependence;

  // An organic-scoped form backend whose unique failure rate degraded.
  const formCorroborates =
    signals.form.eligible &&
    signals.form.direction === 'down' &&
    report.selectedForm?.scope === 'organic_search' &&
    report.sources.forms !== null &&
    report.sources.forms.current.sourceKind !== organicIndependence &&
    !signals.form.caveats.includes('INDIRECT_ALL_CHANNEL_SCOPE') &&
    !signals.form.caveats.includes('INDIRECT_TIME_ZONE_DIFFERS');

  if (diagnosis === 'search_acquisition' && rankCorroborates) {
    reasons.push(
      'A tracked keyword cohort from an independent rank-tracker source shows the same direction, and tracking is verified.',
    );
    return { strength: 'moderate', reasons };
  }
  if (diagnosis === 'post_click' && formCorroborates) {
    reasons.push(
      'An independent form backend source shows a degraded unique failure rate for the selected organic form, and tracking is verified.',
    );
    return { strength: 'moderate', reasons };
  }
  if (diagnosis === 'mixed') {
    // Both concerns must be eligible before either corroboration counts.
    const bothEligible =
      (signals.traffic.eligible || signals.rank.eligible) &&
      (signals.conversion.eligible || signals.form.eligible);
    if (bothEligible && (rankCorroborates || formCorroborates)) {
      reasons.push(
        formCorroborates
          ? 'An independent form backend source corroborates the post-click concern, and both concerns are eligible.'
          : 'An independent rank-tracker source corroborates the acquisition concern, and both concerns are eligible.',
      );
      return { strength: 'moderate', reasons };
    }
  }

  reasons.push(
    'No independent source corroborates this outcome. The analytics traffic and conversion figures come from one export, so together they count as a single source.',
  );
  return { strength: 'limited', reasons };
}
