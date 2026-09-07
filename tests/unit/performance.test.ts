import { describe, expect, it } from 'vitest';
import { analyzeReport } from '@/domain/analyze';
import { normalizedReportSchema, type KeywordRow, type LandingPageRow } from '@/domain/report-schema';
import { makeDemoReport, DEMO_NOW } from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';
import { parseDatasetCsv } from '@/features/imports/csv';
import { normalizeDraft } from '@/features/imports/normalize';

/**
 * Performance targets from the specification, measured against the *maximum*
 * accepted input rather than the demo fixture.
 *
 * These are acceptance targets on documented hardware, not benchmark claims.
 * Measured on an Apple silicon laptop with Node 25.6.1; a slower CI runner will
 * be slower. Calculation is measured separately from parsing, and both are
 * separate from database and chart rendering, so a regression can be located.
 *
 * Targets: pure analysis under 250 ms; import validation under 5 s.
 */

const ANALYSIS_BUDGET_MS = 250;
const VALIDATION_BUDGET_MS = 5000;

/** Builds a report at the largest size the schema and limits accept. */
function maximalReport() {
  const report = makeDemoReport();

  // 20,000 keyword rows: the per-file row limit, as 10,000 matched members.
  const keywords: KeywordRow[] = [];
  for (let member = 0; member < 10_000; member += 1) {
    const keyword = `commercial term ${String(member).padStart(6, '0')}`;
    const baseline = (member % 40) + 1;
    const current = ((member * 7) % 40) + 1;
    keywords.push({
      period: 'baseline',
      keyword,
      device: 'desktop',
      location: 'US',
      searchEngine: 'google',
      position: baseline,
      intent: 'commercial',
      tracked: true,
    });
    keywords.push({
      period: 'current',
      keyword,
      device: 'desktop',
      location: 'US',
      searchEngine: 'google',
      position: current,
      intent: 'commercial',
      tracked: true,
    });
  }

  // 20,000 landing-page rows as 10,000 paths across both periods.
  const landingPages: LandingPageRow[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    const path = `/page-${String(index).padStart(6, '0')}`;
    landingPages.push({ period: 'baseline', path, sessions: index % 500 });
    landingPages.push({ period: 'current', path, sessions: (index * 3) % 500 });
  }

  report.datasets.keywords = keywords;
  report.datasets.landingPages = landingPages;
  return normalizedReportSchema.parse(report);
}

function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('performance targets', () => {
  it('analyses a maximum-size report within the budget', () => {
    const report = maximalReport();
    const complaint = makeDemoComplaint();
    const options = { now: new Date(DEMO_NOW), ruleVersion: '1.0.0' as const };

    // Warm once so the measurement is not dominated by first-call compilation.
    analyzeReport(report, complaint, options);

    const runs = [0, 0, 0].map(() =>
      elapsed(() => {
        analyzeReport(report, complaint, options);
      }),
    );
    const best = Math.min(...runs);

    console.log(
      `analyzeReport over 20,000 keyword rows and 20,000 landing-page rows: ${best.toFixed(1)} ms (budget ${ANALYSIS_BUDGET_MS} ms)`,
    );
    expect(best).toBeLessThan(ANALYSIS_BUDGET_MS);
  });

  it('parses and validates a maximum-size CSV within the budget', () => {
    const header = 'period,keyword,device,location,search_engine,position,intent,tracked\n';
    const rows: string[] = [];
    for (let member = 0; member < 10_000; member += 1) {
      const keyword = `commercial term ${String(member).padStart(6, '0')}`;
      rows.push(`baseline,${keyword},desktop,US,google,${(member % 40) + 1},commercial,true`);
      rows.push(`current,${keyword},desktop,US,google,${((member * 7) % 40) + 1},commercial,true`);
    }
    const bytes = new TextEncoder().encode(header + rows.join('\n') + '\n');
    expect(rows).toHaveLength(20_000);

    const parseMs = elapsed(() => {
      const result = parseDatasetCsv('keywords', bytes);
      expect(result.ok).toBe(true);
      expect(result.rowCount).toBe(20_000);
    });

    const report = maximalReport();
    const validateMs = elapsed(() => {
      const result = normalizeDraft(report);
      expect(result.ok).toBe(true);
    });

    console.log(
      `parseDatasetCsv 20,000 rows: ${parseMs.toFixed(1)} ms; normalizeDraft maximum report: ${validateMs.toFixed(1)} ms (combined budget ${VALIDATION_BUDGET_MS} ms)`,
    );
    expect(parseMs + validateMs).toBeLessThan(VALIDATION_BUDGET_MS);
  });

  it('builds the dashboard view model for a maximum-size report quickly', async () => {
    const { buildDashboardViewModel } = await import('@/features/dashboard/view-model');
    const report = maximalReport();
    const complaint = makeDemoComplaint();
    const result = analyzeReport(report, complaint, {
      now: new Date(DEMO_NOW),
      ruleVersion: '1.0.0',
    });

    const ms = elapsed(() => {
      buildDashboardViewModel({
        report,
        complaint,
        result,
        response: { revision: 1, generatedText: 'x', editedText: null },
        clientName: 'Perf Client',
        reportLabel: 'r',
        now: new Date(DEMO_NOW),
      });
    });

    console.log(`buildDashboardViewModel for the maximum report: ${ms.toFixed(1)} ms`);
    // The view model is a pure mapping; it must not become a second engine.
    expect(ms).toBeLessThan(ANALYSIS_BUDGET_MS);
  });
});
