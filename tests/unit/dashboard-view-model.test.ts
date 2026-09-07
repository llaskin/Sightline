import { describe, expect, it } from 'vitest';
import { buildDashboardViewModel } from '@/features/dashboard/view-model';
import { analyzeReport } from '@/domain/analyze';
import { makeDemoReport, DEMO_NOW } from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';
import type { NormalizedReport } from '@/domain/report-schema';

function build(mutate: (report: NormalizedReport) => void = () => {}) {
  const report = makeDemoReport();
  mutate(report);
  const complaint = makeDemoComplaint();
  const result = analyzeReport(report, complaint, {
    now: new Date(DEMO_NOW),
    ruleVersion: '1.0.0',
  });
  return buildDashboardViewModel({
    report,
    complaint,
    result,
    response: { revision: 1, generatedText: 'Generated draft', editedText: null },
    clientName: 'Northstar Services',
    reportLabel: '10 August 2026 Report',
    now: new Date(DEMO_NOW),
  });
}

describe('metric cards', () => {
  it('shows the four screenshot metrics with corrected arithmetic', () => {
    const view = build();
    const byKey = Object.fromEntries(view.metrics.map((metric) => [metric.key, metric]));

    expect(byKey.traffic.value).toBe('+74%');
    expect(byKey.traffic.detail).toBe('12,540 vs 7,210');
    expect(byKey.keywords.value).toBe('+31');
    expect(byKey.keywords.detail).toBe('85 vs 54');
    // -42.884756% rounds to -43%, not the screenshot's -42%.
    expect(byKey.conversion.value).toBe('-43%');
    expect(byKey.conversion.detail).toBe('1.2% vs 2.1%');
    expect(byKey.formErrors.value).toBe('3x');
    expect(byKey.formErrors.detail).toBe('15 vs 5');
  });

  it('gives every metric a drawer with the formula, sources and freshness', () => {
    const view = build();
    for (const metric of view.metrics) {
      expect(metric.drawer.formula.length).toBeGreaterThan(0);
      expect(metric.drawer.sources.length).toBeGreaterThan(0);
      expect(metric.drawer.retrievedAt.length).toBeGreaterThan(0);
      expect(metric.drawer.coverage.length).toBeGreaterThan(0);
      expect(metric.drawer.canInformComplaint.length).toBeGreaterThan(0);
    }
  });

  it('carries the numerator and denominator behind each rate', () => {
    const view = build();
    const conversion = view.metrics.find((metric) => metric.key === 'conversion')!;
    expect(conversion.drawer.rows.some((row) => row.value.includes('151'))).toBe(true);
    expect(conversion.drawer.rows.some((row) => row.value.includes('7,210'))).toBe(true);
  });

  it('shows a missing metric as not provided rather than zero', () => {
    const view = build((report) => {
      report.datasets.forms = null;
      report.sources.forms = null;
      report.selectedForm = null;
    });
    const formErrors = view.metrics.find((metric) => metric.key === 'formErrors')!;
    expect(formErrors.value).toBe('Not provided');
    expect(formErrors.detail).toBe('Not provided');
  });
});

describe('AC-17 and AC-19 chart honesty', () => {
  it('uses the supplied trend rows and never invents points', () => {
    const view = build();
    expect(view.chart.series).toHaveLength(6);
    expect(view.chart.series.map((point) => point.sessions)).toEqual([
      3500, 5200, 7000, 9000, 7210, 12540,
    ]);
    expect(view.chart.series.map((point) => point.endDate)).toEqual([
      '2026-03-13',
      '2026-04-12',
      '2026-05-12',
      '2026-06-11',
      '2026-07-11',
      '2026-08-10',
    ]);
  });

  it('returns no series at all when no trend data was supplied', () => {
    const view = build((report) => {
      report.datasets.trafficTrend = null;
      report.sources.trafficTrend = null;
    });
    expect(view.chart.series).toEqual([]);
    expect(view.chart.emptyReason).toBe('Trend data not provided');
    // No sparkline is drawn from two summary values either.
    for (const metric of view.metrics) expect(metric.sparkline).toBeNull();
  });

  it('never draws a metric sparkline from two summary values', () => {
    const view = build();
    for (const metric of view.metrics) {
      expect(metric.sparkline).toBeNull();
    }
  });

  it('disables range options that are not available', () => {
    const view = build((report) => {
      report.datasets.trafficTrend = report.datasets.trafficTrend!.slice(4);
    });
    const sixMonths = view.chart.rangeOptions.find((option) => option.value === 'last6')!;
    expect(sixMonths.disabled).toBe(true);
    const three = view.chart.rangeOptions.find((option) => option.value === 'last3')!;
    expect(three.disabled).toBe(true);
  });

  it('provides an equivalent data table for the chart', () => {
    const view = build();
    expect(view.chart.table).toHaveLength(6);
    expect(view.chart.table[0]).toHaveProperty('period');
    expect(view.chart.table[0]).toHaveProperty('sessions');
  });

  it('never sums daily unique users into a longer total', () => {
    const view = build();
    // Each displayed user figure is the supplied aggregate for that bucket.
    expect(view.chart.series.map((point) => point.activeUsers)).toEqual([
      2800, 4100, 5600, 7300, 5800, 10150,
    ]);
    expect(view.chart.usersNote).toContain('supplied');
  });
});

describe('tables', () => {
  it('shows the top five landing pages by current sessions, labelled as a subset', () => {
    const view = build();
    expect(view.pages.rows.length).toBeLessThanOrEqual(5);
    expect(view.pages.rows[0].path).toBe('/seo-services');
    expect(view.pages.rows[0].sessions).toBe(2340);
    expect(view.pages.isSubset).toBe(true);
    expect(view.pages.caption.toLowerCase()).toContain('landing-page sessions');
  });

  it('shows the top five keyword improvements with signed movement', () => {
    const view = build();
    expect(view.keywords.rows.length).toBeLessThanOrEqual(5);
    expect(view.keywords.rows[0].movement).toBe(12);
    expect(view.keywords.rows[0].baselinePosition).toBe(18);
    expect(view.keywords.rows[0].currentPosition).toBe(6);
  });

  it('labels an unranked transition in words rather than a fake rank', () => {
    const view = build((report) => {
      const rows = report.datasets.keywords!;
      const target = rows.find((row) => row.period === 'current')!;
      target.position = null;
    });
    const unranked = view.keywords.allRows.find((row) => row.currentPosition === null);
    expect(unranked?.movementLabel).toBe('Left the ranked set');
  });

  it('labels a Search Console cohort as observed queries', () => {
    const view = build((report) => {
      report.sources.keywords!.baseline.sourceKind = 'gsc';
      report.sources.keywords!.current.sourceKind = 'gsc';
    });
    expect(view.keywords.caption.toLowerCase()).toContain('observed');
  });
});

describe('panels', () => {
  it('shows the complaint verbatim with its category and received date', () => {
    const view = build();
    expect(view.complaint.originalText).toBe('SEO isn’t working. We haven’t gotten any leads.');
    expect(view.complaint.categoryLabel).toBe('No leads at all');
    expect(view.complaint.periodLabel).toBe('12 Jul 2026 - 10 Aug 2026');
  });

  it('labels the diagnosis panel as evidence based, never as AI', () => {
    const view = build();
    expect(view.diagnosis.title).toBe('Evidence diagnosis');
    expect(JSON.stringify(view)).not.toMatch(/\bAI\b/);
  });

  it('positions the investigation focus by category with no percentage', () => {
    const view = build();
    expect(view.assessment.focus).toBe('post_click');
    expect(view.assessment.focusLabel).toBe('Post-click');
    expect(view.assessment.focusDescription.length).toBeGreaterThan(0);
    expect(JSON.stringify(view.assessment)).not.toMatch(/\d+%\s*(valid|confiden)/i);
  });

  it('renders caveat codes as readable text', () => {
    const view = build((report) => {
      report.selectedForm = { formId: 'contact', scope: 'all_channels' };
      report.datasets.forms = report.datasets.forms!.map((row) => ({ ...row, scope: 'all_channels' as const }));
    });
    const formFinding = view.diagnosis.findings.find((finding) => finding.ruleId === 'form.failureRate');
    expect(formFinding?.caveats.some((caveat) => caveat.includes('all channels'))).toBe(true);
  });

  it('labels the response as generated until it is edited', () => {
    const view = build();
    expect(view.response?.label).toBe('Generated draft');
    expect(view.response?.text).toBe('Generated draft');
  });
});

describe('freshness', () => {
  it('shows the real source export time and report period, not today', () => {
    const view = build();
    expect(view.footer.reportPeriod).toBe('12 Jul 2026 - 10 Aug 2026');
    expect(view.footer.sourceFreshness).toContain('2026');
    expect(view.footer.isHistorical).toBe(false);
  });

  it('marks a report older than 45 days as historical without invalidating it', () => {
    const view = build();
    const later = buildDashboardViewModel({
      report: makeDemoReport(),
      complaint: makeDemoComplaint(),
      result: analyzeReport(makeDemoReport(), makeDemoComplaint(), {
        now: new Date(DEMO_NOW),
        ruleVersion: '1.0.0',
      }),
      response: { revision: 1, generatedText: 'x', editedText: null },
      clientName: 'Northstar Services',
      reportLabel: 'r',
      now: new Date('2026-12-01T12:00:00Z'),
    });
    expect(view.footer.isHistorical).toBe(false);
    expect(later.footer.isHistorical).toBe(true);
    // The comparison itself is still complete and valid.
    expect(later.metrics.find((metric) => metric.key === 'traffic')!.value).toBe('+74%');
  });
});
