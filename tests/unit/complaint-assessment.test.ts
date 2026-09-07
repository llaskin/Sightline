import { describe, expect, it } from 'vitest';
import { analyzeReport } from '@/domain/analyze';
import { buildReport, cohort, complaint, outcome, NOW } from '../fixtures/analysis-builder';
import type { NormalizedReport } from '@/domain/report-schema';
import type { ComplaintInput } from '@/domain/complaint-schema';

function assess(report: NormalizedReport, input: ComplaintInput) {
  return analyzeReport(report, input, { now: NOW, ruleVersion: '1.0.0' });
}

// ---------------------------------------------------------------------------
// AC-10 / AC-11 — received leads
// ---------------------------------------------------------------------------

describe('AC-10 no received-lead evidence', () => {
  it('leaves a no-leads complaint unverified despite recorded analytics actions', () => {
    const result = assess(buildReport(), complaint({ category: 'no_leads' }));
    expect(result.complaintAssessment).toBe('unverified');
    expect(result.assessmentReason.toLowerCase()).toContain('received lead');
  });

  it('does not treat lead sessions as proof that leads arrived', () => {
    const result = assess(buildReport(), complaint({ category: 'no_leads' }));
    expect(result.complaintAssessment).not.toBe('contradicted');
  });
});

describe('AC-11 CRM-confirmed zero received leads', () => {
  it('supports the outcome while attribution is computed separately', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 14, 0)] }),
      complaint({ category: 'no_leads' }),
    );
    expect(result.complaintAssessment).toBe('supported');
    expect(result.diagnosis).toBe('post_click');
  });

  it('contradicts the outcome when the CRM records leads did arrive', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 14, 9)] }),
      complaint({ category: 'no_leads' }),
    );
    expect(result.complaintAssessment).toBe('contradicted');
  });

  it('keeps a CRM-confirmed zero supported even when analytics tracking is broken', () => {
    const result = assess(
      buildReport({
        trackingStatus: 'known_issue',
        outcomes: [outcome('received_leads', 14, 0)],
      }),
      complaint({ category: 'no_leads' }),
    );
    // The measurement problem governs attribution, not the independent outcome.
    expect(result.diagnosis).toBe('measurement_issue');
    expect(result.complaintAssessment).toBe('supported');
  });

  it('requires complete outcome coverage before claiming an outcome', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 14, 0)], outcomeCoverage: 'partial' }),
      complaint({ category: 'no_leads' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
  });

  it('treats an absent value as unknown rather than as zero', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 14, null)] }),
      complaint({ category: 'no_leads' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
  });
});

// ---------------------------------------------------------------------------
// Other categories
// ---------------------------------------------------------------------------

describe('leads_down', () => {
  it('is supported when current received leads are lower', () => {
    expect(
      assess(
        buildReport({ outcomes: [outcome('received_leads', 40, 12)] }),
        complaint({ category: 'leads_down' }),
      ).complaintAssessment,
    ).toBe('supported');
  });

  it('is contradicted when they are equal or higher', () => {
    expect(
      assess(
        buildReport({ outcomes: [outcome('received_leads', 40, 40)] }),
        complaint({ category: 'leads_down' }),
      ).complaintAssessment,
    ).toBe('contradicted');
  });
});

describe('traffic_down', () => {
  it('compares exact counts literally, independently of diagnosis thresholds', () => {
    // A 1% decline supports the literal claim while remaining below the
    // directional threshold, so the diagnosis stays no_clear_issue.
    const result = assess(
      buildReport({
        baselineSessions: 10_000,
        currentSessions: 9900,
        baselineLeadSessions: 200,
        currentLeadSessions: 198,
      }),
      complaint({ category: 'traffic_down' }),
    );
    expect(result.complaintAssessment).toBe('supported');
    expect(result.diagnosis).toBe('no_clear_issue');
    // The distinction between a literal comparison and a filtered threshold is
    // explained rather than left as an apparent contradiction.
    expect(result.assessmentReason.toLowerCase()).toContain('threshold');
  });

  it('is contradicted when sessions rose', () => {
    expect(
      assess(buildReport(), complaint({ category: 'traffic_down' })).complaintAssessment,
    ).toBe('contradicted');
  });

  it('is unverified for an all-channel complaint without all-channel data', () => {
    const result = assess(
      buildReport({ baselineSessions: 10_000, currentSessions: 5000, currentLeadSessions: 100, baselineLeadSessions: 200 }),
      complaint({ category: 'traffic_down', scope: 'all_channels' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
    expect(result.assessmentReason.toLowerCase()).toContain('all channels');
  });

  it('is unverified when a measurement issue affects the source it relies on', () => {
    const result = assess(
      buildReport({ trackingStatus: 'known_issue', baselineSessions: 10_000, currentSessions: 5000, currentLeadSessions: 100, baselineLeadSessions: 200 }),
      complaint({ category: 'traffic_down' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
  });
});

describe('rankings_down', () => {
  it('is supported within the cohort when the net top-10 change is negative', () => {
    const result = assess(
      buildReport({
        keywords: cohort([
          { baseline: 4, current: 15, count: 10 },
          { baseline: 5, current: 5, count: 15 },
        ]),
        currentLeadSessions: 300,
      }),
      complaint({ category: 'rankings_down' }),
    );
    expect(result.complaintAssessment).toBe('supported');
    expect(result.assessmentReason.toLowerCase()).toContain('cohort');
  });

  it('is contradicted within the cohort when the net change is not negative', () => {
    const result = assess(
      buildReport({
        keywords: cohort([
          { baseline: 18, current: 6, count: 10 },
          { baseline: 5, current: 5, count: 15 },
        ]),
        currentLeadSessions: 300,
      }),
      complaint({ category: 'rankings_down' }),
    );
    expect(result.complaintAssessment).toBe('contradicted');
  });

  it('is unverified when only Search Console rows are available', () => {
    const result = assess(
      buildReport({
        keywords: cohort([{ baseline: 4, current: 15, count: 30 }]),
        keywordSourceKind: 'gsc',
        currentLeadSessions: 300,
      }),
      complaint({ category: 'rankings_down' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
  });
});

describe('revenue_down', () => {
  it('is supported when comparable revenue fell', () => {
    expect(
      assess(
        buildReport({ outcomes: [outcome('revenue', 500_000, 300_000)] }),
        complaint({ category: 'revenue_down' }),
      ).complaintAssessment,
    ).toBe('supported');
  });

  it('is unverified when revenue was not supplied', () => {
    expect(
      assess(buildReport(), complaint({ category: 'revenue_down' })).complaintAssessment,
    ).toBe('unverified');
  });
});

describe('lead_quality', () => {
  it('is supported when the qualified rate fell with a denominator above zero', () => {
    const result = assess(
      buildReport({
        outcomes: [outcome('received_leads', 100, 100), outcome('qualified_leads', 40, 10)],
      }),
      complaint({ category: 'lead_quality' }),
    );
    expect(result.complaintAssessment).toBe('supported');
  });

  it('is unverified when the denominator is zero in a period', () => {
    const result = assess(
      buildReport({
        outcomes: [outcome('received_leads', 0, 100), outcome('qualified_leads', 0, 10)],
      }),
      complaint({ category: 'lead_quality' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
  });
});

describe('categories with no measurable claim', () => {
  it('always leaves seo_underperforming and other unverified', () => {
    for (const category of ['seo_underperforming', 'other'] as const) {
      const result = assess(
        buildReport({ outcomes: [outcome('received_leads', 40, 0)] }),
        complaint({ category }),
      );
      expect(result.complaintAssessment).toBe('unverified');
      // Diagnostic findings are still reported separately.
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-23 — period alignment
// ---------------------------------------------------------------------------

describe('AC-23 complaint period differing from the report', () => {
  it('leaves the outcome unverified and warns about the misalignment', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 40, 0)] }),
      complaint({ category: 'no_leads', periodStart: '2026-05-01', periodEnd: '2026-05-30' }),
    );
    expect(result.complaintAssessment).toBe('unverified');
    expect(result.periodAlignment).toBe('mismatched');
    expect(result.assessmentReason.toLowerCase()).toContain('period');
  });

  it('still ties the diagnosis explicitly to the report dates', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 40, 0)] }),
      complaint({ category: 'no_leads', periodStart: '2026-05-01', periodEnd: '2026-05-30' }),
    );
    expect(result.diagnosis).toBe('post_click');
    const trafficFinding = result.findings.find((f) => f.ruleId === 'traffic.change');
    expect(trafficFinding?.text).toContain('2026-07-12');
  });

  it('reports alignment when the windows match exactly', () => {
    const result = assess(
      buildReport({ outcomes: [outcome('received_leads', 40, 0)] }),
      complaint({ category: 'no_leads' }),
    );
    expect(result.periodAlignment).toBe('aligned');
    expect(result.complaintAssessment).toBe('supported');
  });
});
