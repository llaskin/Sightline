import { describe, expect, it } from 'vitest';
import { parseDatasetCsv, DEFAULT_LIMITS } from '@/features/imports/csv';
import { buildTemplate, TEMPLATE_DEFINITIONS } from '@/features/imports/templates';
import { normalizedReportSchema } from '@/domain/report-schema';
import { makeDemoReport, DEMO_NOW } from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';
import { validateComparability, inclusiveDayCount } from '@/domain/comparability';
import { compareKeywordCohort } from '@/domain/metrics';

const bytes = (text: string) => new TextEncoder().encode(text);

function codes(result: ReturnType<typeof parseDatasetCsv>): string[] {
  return result.errors.map((error) => error.code);
}

// ---------------------------------------------------------------------------
// Well-formed input
// ---------------------------------------------------------------------------

describe('CSV parsing of well-formed input', () => {
  it('accepts the organic summary template shape', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions\nbaseline,7210,5800,151\ncurrent,12540,10150,150\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([
      { period: 'baseline', sessions: 7210, activeUsers: 5800, leadSessions: 151 },
      { period: 'current', sessions: 12540, activeUsers: 10150, leadSessions: 150 },
    ]);
    expect(result.rowCount).toBe(2);
  });

  it('accepts a UTF-8 byte order mark', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('﻿period,sessions,active_users,lead_sessions\nbaseline,100,80,4\ncurrent,120,90,5\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it('accepts headers in any column order', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('lead_sessions,period,active_users,sessions\n151,baseline,5800,7210\n150,current,10150,12540\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0]).toEqual({
      period: 'baseline',
      sessions: 7210,
      activeUsers: 5800,
      leadSessions: 151,
    });
  });

  it('preserves quoted commas and quoted newlines inside a text cell', () => {
    const result = parseDatasetCsv(
      'keywords',
      bytes(
        'period,keyword,device,location,search_engine,position,intent,tracked\n' +
          'baseline,"seo services, near me",desktop,US,google,5,commercial,true\n' +
          'current,"seo services, near me",desktop,US,google,4,commercial,true\n',
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0].keyword).toBe('seo services, near me');
  });

  it('reads a blank nullable numeric cell as unknown rather than zero', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions\nbaseline,7210,,\ncurrent,12540,,\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0].activeUsers).toBeNull();
    expect(result.rows[0].leadSessions).toBeNull();
  });

  it('reads a blank keyword position as confirmed unranked rather than unknown', () => {
    const result = parseDatasetCsv(
      'keywords',
      bytes(
        'period,keyword,device,location,search_engine,position,intent,tracked\n' +
          'baseline,seo,desktop,US,google,8,commercial,true\n' +
          'current,seo,desktop,US,google,,commercial,true\n',
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.rows[1].position).toBeNull();
  });

  it('keeps embedded HTML as inert text rather than interpreting it', () => {
    const result = parseDatasetCsv(
      'keywords',
      bytes(
        'period,keyword,device,location,search_engine,position,intent,tracked\n' +
          'baseline,"<script>alert(1)</script>",desktop,US,google,5,commercial,true\n' +
          'current,"<script>alert(1)</script>",desktop,US,google,4,commercial,true\n',
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0].keyword).toBe('<script>alert(1)</script>');
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe('CSV rejection', () => {
  it('rejects a missing required header naming the column', () => {
    const result = parseDatasetCsv('organic', bytes('period,sessions\nbaseline,10\ncurrent,20\n'));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('MISSING_HEADER');
    expect(result.errors.some((e) => e.field === 'active_users')).toBe(true);
  });

  it('rejects a duplicate header', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,sessions,active_users,lead_sessions\nbaseline,1,2,3,4\n'),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('DUPLICATE_HEADER');
  });

  it('rejects an unknown header rather than ignoring it', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions,revenue\nbaseline,1,2,3,4\n'),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('UNKNOWN_HEADER');
    expect(result.errors.some((e) => e.field === 'revenue')).toBe(true);
  });

  it('rejects bytes that are not valid UTF-8', () => {
    const result = parseDatasetCsv('organic', new Uint8Array([0x70, 0x65, 0xff, 0xfe, 0x0a]));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('INVALID_ENCODING');
  });

  it('rejects a localized numeric separator instead of guessing its meaning', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions\nbaseline,"7.210",5800,151\ncurrent,12540,10150,150\n'),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('NOT_A_NUMBER');
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].field).toBe('sessions');
    expect(result.errors[0].value).toBe('7.210');
  });

  it('rejects thousands separators and non-finite values', () => {
    for (const value of ['12,540', '1 000', 'Infinity', 'NaN', '1e400']) {
      const result = parseDatasetCsv(
        'organic',
        bytes(`period,sessions,active_users,lead_sessions\nbaseline,"${value}",1,1\ncurrent,120,1,1\n`),
      );
      expect(result.ok, `value ${value} should be rejected`).toBe(false);
    }
  });

  it('rejects a fractional count', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions\nbaseline,7210.5,1,1\ncurrent,120,1,1\n'),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('NOT_AN_INTEGER');
  });

  it('rejects a spreadsheet formula in a text cell', () => {
    for (const payload of ['=1+1', '+SUM(A1)', '@IMPORT()', '\t=cmd|calc']) {
      const result = parseDatasetCsv(
        'keywords',
        bytes(
          'period,keyword,device,location,search_engine,position,intent,tracked\n' +
            `baseline,"${payload}",desktop,US,google,5,commercial,true\n`,
        ),
      );
      expect(result.ok, `payload ${payload} should be rejected`).toBe(false);
      expect(codes(result)).toContain('FORMULA_CELL');
    }
  });

  it('rejects malformed quoting', () => {
    const result = parseDatasetCsv(
      'keywords',
      bytes(
        'period,keyword,device,location,search_engine,position,intent,tracked\n' +
          'baseline,"unterminated,desktop,US,google,5,commercial,true\n',
      ),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an unexpected enum value naming the field', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions\nprevious,10,1,1\ncurrent,20,1,1\n'),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('INVALID_ENUM');
    expect(result.errors[0].field).toBe('period');
  });

  it('rejects a row whose column count does not match the header', () => {
    const result = parseDatasetCsv(
      'organic',
      bytes('period,sessions,active_users,lead_sessions\nbaseline,10,1\n'),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('COLUMN_COUNT');
  });

  it('rejects an entirely empty file', () => {
    const result = parseDatasetCsv('organic', bytes(''));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('EMPTY_FILE');
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe('CSV bounds', () => {
  it('rejects a file larger than the byte limit before parsing it', () => {
    const oversized = new Uint8Array(DEFAULT_LIMITS.maxBytes + 1);
    const result = parseDatasetCsv('organic', oversized);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('FILE_TOO_LARGE');
    // Nothing beyond the size check ran.
    expect(result.rowCount).toBe(0);
  });

  it('stops at the row limit rather than reading an unbounded file', () => {
    const limits = { ...DEFAULT_LIMITS, maxRows: 10 };
    const rows = Array.from({ length: 25 }, (_, i) => `/page-${i},10`).join('\n');
    const result = parseDatasetCsv(
      'landingPages',
      bytes(`period,path,sessions\n${rows.split('\n').map((r) => `current,${r}`).join('\n')}\n`),
      limits,
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('TOO_MANY_ROWS');
  });

  it('rejects a text cell longer than the cell limit', () => {
    const long = 'a'.repeat(DEFAULT_LIMITS.maxCellChars + 1);
    const result = parseDatasetCsv(
      'keywords',
      bytes(
        'period,keyword,device,location,search_engine,position,intent,tracked\n' +
          `baseline,${long},desktop,US,google,5,commercial,true\n`,
      ),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('CELL_TOO_LONG');
  });

  it('caps returned errors at 100 while reporting the true total', () => {
    const badRows = Array.from({ length: 250 }, () => 'current,/x,notanumber').join('\n');
    const result = parseDatasetCsv('landingPages', bytes(`period,path,sessions\n${badRows}\n`));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeLessThanOrEqual(100);
    expect(result.totalErrorCount).toBeGreaterThan(100);
  });

  it('hashes the original bytes and reports their size', () => {
    const content = 'period,sessions,active_users,lead_sessions\nbaseline,100,80,4\ncurrent,120,90,5\n';
    const result = parseDatasetCsv('organic', bytes(content));
    expect(result.byteCount).toBe(bytes(content).byteLength);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The same bytes always hash the same way.
    expect(parseDatasetCsv('organic', bytes(content)).contentHash).toBe(result.contentHash);
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('downloadable templates', () => {
  it('produces a template for every dataset that parses back cleanly', () => {
    for (const definition of TEMPLATE_DEFINITIONS) {
      const csv = buildTemplate(definition.dataset);
      const result = parseDatasetCsv(definition.dataset, bytes(csv));
      expect(result.ok, `${definition.dataset} template must round-trip`).toBe(true);
      expect(result.rows.length).toBeGreaterThan(0);
    }
  });

  it('exposes the exact required headers for each dataset', () => {
    const organic = TEMPLATE_DEFINITIONS.find((d) => d.dataset === 'organic');
    expect(organic?.columns.map((c) => c.name)).toEqual([
      'period',
      'sessions',
      'active_users',
      'lead_sessions',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Demo fixture
// ---------------------------------------------------------------------------

describe('fictional demo report', () => {
  it('is schema valid and returns a fresh object each call', () => {
    const first = makeDemoReport();
    const second = makeDemoReport();
    expect(normalizedReportSchema.safeParse(first).success).toBe(true);
    expect(first).not.toBe(second);
    first.datasets.organic[0].sessions = 1;
    expect(second.datasets.organic[0].sessions).toBe(7210);
  });

  it('uses the exact counts and windows from the specification', () => {
    const report = makeDemoReport();
    expect(report.metadata.baselineStart).toBe('2026-06-12');
    expect(report.metadata.baselineEnd).toBe('2026-07-11');
    expect(report.metadata.currentStart).toBe('2026-07-12');
    expect(report.metadata.currentEnd).toBe('2026-08-10');
    expect(inclusiveDayCount('2026-06-12', '2026-07-11')).toBe(30);
    expect(inclusiveDayCount('2026-07-12', '2026-08-10')).toBe(30);
    expect(report.datasets.organic).toEqual([
      { period: 'baseline', sessions: 7210, activeUsers: 5800, leadSessions: 151 },
      { period: 'current', sessions: 12540, activeUsers: 10150, leadSessions: 150 },
    ]);
  });

  it('uses a fictional client and domain only', () => {
    const report = makeDemoReport();
    expect(report.metadata.propertyLabel).toContain('example.com');
  });

  it('supplies a 100-member cohort producing 54 -> 85 top-10 and net +31', () => {
    const report = makeDemoReport();
    const keywords = report.datasets.keywords!;
    expect(keywords).toHaveLength(200);
    const cohort = compareKeywordCohort(keywords, {
      baseline: { sourceKind: 'rank_tracker' },
      current: { sourceKind: 'rank_tracker' },
    });
    expect(cohort.eligibleMembers).toBe(100);
    expect(cohort.baselineTop10).toBe(54);
    expect(cohort.currentTop10).toBe(85);
    expect(cohort.entered).toBe(31);
    expect(cohort.exited).toBe(0);
    expect(cohort.netTop10Change).toBe(31);
    expect(cohort.fixedCohortEligible).toBe(true);
  });

  it('derives every trend bucket start as its end minus 29 calendar days', () => {
    const trend = makeDemoReport().datasets.trafficTrend!;
    expect(trend).toHaveLength(6);
    expect(trend.map((row) => row.endDate)).toEqual([
      '2026-03-13',
      '2026-04-12',
      '2026-05-12',
      '2026-06-11',
      '2026-07-11',
      '2026-08-10',
    ]);
    for (const row of trend) {
      expect(inclusiveDayCount(row.startDate, row.endDate)).toBe(30);
    }
    expect(trend.map((row) => row.sessions)).toEqual([3500, 5200, 7000, 9000, 7210, 12540]);
    expect(trend.map((row) => row.activeUsers)).toEqual([2800, 4100, 5600, 7300, 5800, 10150]);
  });

  it('has trend buckets that agree with the summary windows they cover', () => {
    // The last two buckets exactly cover the baseline and current windows, so the
    // schema's agreement check is exercised by the demo fixture itself.
    const report = makeDemoReport();
    const parsed = normalizedReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);

    const conflicting = makeDemoReport();
    conflicting.datasets.trafficTrend![5].sessions = 99999;
    const rejected = normalizedReportSchema.safeParse(conflicting);
    expect(rejected.success).toBe(false);
  });

  it('supplies no received-lead evidence, so no outcome can be claimed', () => {
    expect(makeDemoReport().datasets.outcomes).toBeNull();
  });

  it('is fully comparable at the fixed demo instant', () => {
    const result = validateComparability(makeDemoReport(), new Date(DEMO_NOW));
    expect(result.windowErrors).toEqual([]);
    expect(result.baseEligible).toBe(true);
    expect(result.measurementIssue).toBe(false);
    expect(result.datasetFlags.keywords.eligible).toBe(true);
    expect(result.datasetFlags.forms.eligible).toBe(true);
  });

  it('supplies a complaint that matches the current reporting window exactly', () => {
    const complaint = makeDemoComplaint();
    const report = makeDemoReport();
    expect(complaint.periodStart).toBe(report.metadata.currentStart);
    expect(complaint.periodEnd).toBe(report.metadata.currentEnd);
    expect(complaint.category).toBe('no_leads');
    expect(complaint.scope).toBe('organic_search');
  });
});
