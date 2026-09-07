import { z } from 'zod';
import { scopeSchema } from './report-schema';

/** Structured categories the user selects; the original wording is preserved separately. */
export const complaintCategorySchema = z.enum([
  'no_leads',
  'leads_down',
  'traffic_down',
  'rankings_down',
  'revenue_down',
  'lead_quality',
  'seo_underperforming',
  'other',
]);

export const complaintStatusSchema = z.enum(['open', 'analyzed', 'resolved']);

export const MAX_COMPLAINT_TEXT = 5000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Must be a YYYY-MM-DD date' });

export const complaintInputSchema = z
  .object({
    /** The client's own words, stored verbatim and always treated as data. */
    originalText: z.string().min(1, { error: 'The complaint text is required' }).max(MAX_COMPLAINT_TEXT),
    category: complaintCategorySchema,
    scope: scopeSchema,
    periodStart: isoDate,
    periodEnd: isoDate,
    receivedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
      error: 'Must be an ISO 8601 timestamp',
    }),
  })
  .superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: 'The complaint period cannot end before it starts',
      });
    }
  });

export type ComplaintCategory = z.infer<typeof complaintCategorySchema>;
export type ComplaintStatus = z.infer<typeof complaintStatusSchema>;
export type ComplaintInput = z.infer<typeof complaintInputSchema>;

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  no_leads: 'No leads at all',
  leads_down: 'Fewer leads than before',
  traffic_down: 'Traffic has fallen',
  rankings_down: 'Rankings have fallen',
  revenue_down: 'Revenue has fallen',
  lead_quality: 'Lead quality has fallen',
  seo_underperforming: 'SEO is underperforming generally',
  other: 'Something else',
};

/** Categories that make a specific measurable claim about an outcome. */
export const MEASURABLE_CATEGORIES: ComplaintCategory[] = [
  'no_leads',
  'leads_down',
  'traffic_down',
  'rankings_down',
  'revenue_down',
  'lead_quality',
];
