import type { ComplaintInput } from '../complaint-schema';

/**
 * The fictional demo complaint. Its window matches the current reporting period
 * exactly, so the outcome assessment is aligned; it still resolves to
 * `unverified` because no received-lead evidence is supplied.
 */
export function makeDemoComplaint(): ComplaintInput {
  return {
    originalText: 'SEO isn’t working. We haven’t gotten any leads.',
    category: 'no_leads',
    scope: 'organic_search',
    periodStart: '2026-07-12',
    periodEnd: '2026-08-10',
    receivedAt: '2026-08-11T09:00:00.000Z',
  };
}
