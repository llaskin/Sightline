import type { DatasetName } from '@/domain/report-schema';

/**
 * Canonical CSV templates. Release 1 accepts these headers, not arbitrary
 * provider exports, so that every imported value has one documented meaning.
 */

export type ColumnKind = 'enum' | 'text' | 'integer' | 'nullableInteger' | 'boolean' | 'date';

export type ColumnDefinition = {
  /** snake_case name, used only at the CSV boundary. */
  name: string;
  /** camelCase property on the canonical row. */
  field: string;
  kind: ColumnKind;
  values?: readonly string[];
  description: string;
};

export type TemplateDefinition = {
  dataset: DatasetName;
  title: string;
  required: boolean;
  columns: ColumnDefinition[];
  sampleRows: string[][];
  rules: string[];
};

const period: ColumnDefinition = {
  name: 'period',
  field: 'period',
  kind: 'enum',
  values: ['baseline', 'current'],
  description: 'Which of the two comparison windows this row describes.',
};

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    dataset: 'organic',
    title: 'Organic summary (required)',
    required: true,
    columns: [
      period,
      {
        name: 'sessions',
        field: 'sessions',
        kind: 'integer',
        description: 'Organic search sessions in the window. Required.',
      },
      {
        name: 'active_users',
        field: 'activeUsers',
        kind: 'nullableInteger',
        description:
          'Aggregate unique active users for this exact window. Leave blank if unknown. Never a sum of daily users.',
      },
      {
        name: 'lead_sessions',
        field: 'leadSessions',
        kind: 'nullableInteger',
        description:
          'Sessions containing the configured lead action. Not an event count and not received leads. Leave blank if unknown.',
      },
    ],
    sampleRows: [
      ['baseline', '7210', '5800', '151'],
      ['current', '12540', '10150', '150'],
    ],
    rules: [
      'Exactly two rows: one `baseline` and one `current`.',
      'A blank cell means unknown. It never means zero.',
      'Lead sessions can never exceed sessions.',
    ],
  },
  {
    dataset: 'keywords',
    title: 'Keywords (optional)',
    required: false,
    columns: [
      period,
      { name: 'keyword', field: 'keyword', kind: 'text', description: 'The tracked query text.' },
      { name: 'device', field: 'device', kind: 'text', description: 'For example desktop or mobile.' },
      { name: 'location', field: 'location', kind: 'text', description: 'For example US.' },
      {
        name: 'search_engine',
        field: 'searchEngine',
        kind: 'text',
        description: 'For example google.',
      },
      {
        name: 'position',
        field: 'position',
        kind: 'nullableInteger',
        description:
          'Whole rank of 1 or greater. Blank on a present row means confirmed unranked; omitting the row entirely means unknown.',
      },
      {
        name: 'intent',
        field: 'intent',
        kind: 'enum',
        values: ['commercial', 'informational', 'unknown'],
        description: 'Only rows marked commercial in both periods enter the cohort.',
      },
      {
        name: 'tracked',
        field: 'tracked',
        kind: 'boolean',
        description: 'true or false. Only rows tracked in both periods enter the cohort.',
      },
    ],
    sampleRows: [
      ['baseline', 'seo services', 'desktop', 'US', 'google', '18', 'commercial', 'true'],
      ['current', 'seo services', 'desktop', 'US', 'google', '6', 'commercial', 'true'],
    ],
    rules: [
      'Supply two observations per cohort member, one per period.',
      'The comparison key is keyword, device, location and search engine together.',
      'Rank-tracker rows and Search Console rows never share a cohort.',
    ],
  },
  {
    dataset: 'forms',
    title: 'Forms (optional)',
    required: false,
    columns: [
      period,
      { name: 'form_id', field: 'formId', kind: 'text', description: 'Stable identifier of the form.' },
      {
        name: 'scope',
        field: 'scope',
        kind: 'enum',
        values: ['organic_search', 'all_channels'],
        description: 'Which traffic these counts cover.',
      },
      {
        name: 'attempts',
        field: 'attempts',
        kind: 'nullableInteger',
        description: 'Unique logical submission attempts. Blank if unknown.',
      },
      {
        name: 'failed_attempts',
        field: 'failedAttempts',
        kind: 'nullableInteger',
        description: 'Unique attempts that failed. Can never exceed attempts.',
      },
      {
        name: 'error_events',
        field: 'errorEvents',
        kind: 'integer',
        description: 'Repeatable error events. A separate count from unique attempts. Required.',
      },
    ],
    sampleRows: [
      ['baseline', 'contact', 'organic_search', '200', '5', '5'],
      ['current', 'contact', 'organic_search', '220', '15', '15'],
    ],
    rules: [
      'Match the same form ID and scope across both periods.',
      'Attempts and failed attempts are unique attempts from one instrumentation source.',
      'Error events may repeat for a single attempt, so they are counted separately.',
    ],
  },
  {
    dataset: 'landingPages',
    title: 'Landing pages (optional)',
    required: false,
    columns: [
      period,
      {
        name: 'path',
        field: 'path',
        kind: 'text',
        description: 'Begins with /. No query string and no fragment.',
      },
      {
        name: 'sessions',
        field: 'sessions',
        kind: 'integer',
        description: 'Organic landing-page sessions. These are not page views.',
      },
    ],
    sampleRows: [
      ['baseline', '/seo-services', '1250'],
      ['current', '/seo-services', '2340'],
    ],
    rules: ['Each path appears at most once per period.'],
  },
  {
    dataset: 'trafficTrend',
    title: 'Traffic trend (optional)',
    required: false,
    columns: [
      {
        name: 'start_date',
        field: 'startDate',
        kind: 'date',
        description: 'First day of the bucket, inclusive, YYYY-MM-DD.',
      },
      {
        name: 'end_date',
        field: 'endDate',
        kind: 'date',
        description: 'Last day of the bucket, inclusive.',
      },
      {
        name: 'sessions',
        field: 'sessions',
        kind: 'integer',
        description: 'Supplied aggregate sessions for this exact bucket.',
      },
      {
        name: 'active_users',
        field: 'activeUsers',
        kind: 'nullableInteger',
        description:
          'Supplied aggregate unique users for this exact bucket. Blank if unknown. Daily unique users are never summed into a longer total.',
      },
    ],
    sampleRows: [
      ['2026-06-12', '2026-07-11', '7210', '5800'],
      ['2026-07-12', '2026-08-10', '12540', '10150'],
    ],
    rules: [
      'Buckets must not overlap.',
      'A bucket that exactly covers a summary window must report the same totals as that window.',
    ],
  },
];

export function templateFor(dataset: DatasetName): TemplateDefinition {
  const found = TEMPLATE_DEFINITIONS.find((definition) => definition.dataset === dataset);
  if (!found) throw new Error(`No CSV template is defined for dataset ${dataset}`);
  return found;
}

/** Renders the downloadable CSV for one dataset: header row plus sample rows. */
export function buildTemplate(dataset: DatasetName): string {
  const definition = templateFor(dataset);
  const header = definition.columns.map((column) => column.name).join(',');
  const rows = definition.sampleRows.map((row) => row.join(','));
  return `${[header, ...rows].join('\n')}\n`;
}
