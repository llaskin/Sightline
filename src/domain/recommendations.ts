import type { Diagnosis, Finding, NextCheck } from './analysis-schema';

/**
 * Deterministic next checks, selected by rule ID. These name a function to
 * involve rather than a person to blame, and they never assert a specific
 * broken plugin, HTTP status, CRM error or deployment, because aggregate data
 * cannot identify one.
 */

type Template = {
  text: string;
  functionToInvolve: NextCheck['functionToInvolve'];
  /** Rule IDs whose findings justify this check, in preference order. */
  supportingRuleIds: string[];
};

const TEMPLATES: Record<Diagnosis, Template[]> = {
  measurement_issue: [
    {
      text: 'Confirm the analytics event configuration and check for consent or tagging changes between the two periods.',
      functionToInvolve: 'analytics',
      supportingRuleIds: ['quality.measurement', 'conversion.change', 'traffic.change'],
    },
    {
      text: 'Compare the analytics figures against the form backend or CRM records for the same dates before attributing any change.',
      functionToInvolve: 'analytics',
      supportingRuleIds: ['quality.measurement', 'form.failureRate', 'traffic.change'],
    },
  ],
  search_acquisition: [
    {
      text: 'Examine query intent and the branded versus non-branded split, then the device, country and landing-page mix, to see whether the traffic that changed is the traffic that converts.',
      functionToInvolve: 'SEO',
      supportingRuleIds: ['traffic.change', 'rank.top10'],
    },
    {
      text: 'Review the tracked commercial keyword cohort for the specific terms that moved, and check indexing and demand for those pages.',
      functionToInvolve: 'SEO',
      supportingRuleIds: ['rank.top10', 'traffic.change'],
    },
  ],
  post_click: [
    {
      text: 'Reproduce the form journey on the affected pages and confirm that a submission is accepted by the backend.',
      functionToInvolve: 'web development',
      supportingRuleIds: ['form.failureRate', 'conversion.change'],
    },
    {
      text: 'Verify that accepted submissions are delivered to the inbox and the CRM, and reconcile that count against the tracked lead sessions for the same dates.',
      functionToInvolve: 'sales operations',
      supportingRuleIds: ['conversion.change', 'form.failureRate'],
    },
    {
      text: 'Inspect the device and browser breakdown and the landing-page fit for the pages receiving the most sessions.',
      functionToInvolve: 'web development',
      supportingRuleIds: ['conversion.change', 'traffic.change'],
    },
  ],
  mixed: [
    {
      text: 'Verify measurement first, so that the acquisition and post-click investigations are working from figures both sides agree on.',
      functionToInvolve: 'analytics',
      supportingRuleIds: ['conversion.change', 'traffic.change'],
    },
    {
      text: 'Examine query intent, device and landing-page mix for the change in search traffic.',
      functionToInvolve: 'SEO',
      supportingRuleIds: ['traffic.change', 'rank.top10'],
    },
    {
      text: 'Reproduce the form journey and confirm backend acceptance and delivery to the CRM.',
      functionToInvolve: 'web development',
      supportingRuleIds: ['form.failureRate', 'conversion.change'],
    },
  ],
  no_clear_issue: [
    {
      text: 'Collect received-lead records from the CRM, call tracking or inbox for these exact dates, so lead delivery can be checked rather than assumed.',
      functionToInvolve: 'sales operations',
      supportingRuleIds: ['conversion.change', 'traffic.change'],
    },
    {
      text: 'Agree with the client on which outcome they are measuring, and over which dates, before changing anything on the site.',
      functionToInvolve: 'analytics',
      supportingRuleIds: ['traffic.change', 'conversion.change'],
    },
  ],
  insufficient_evidence: [
    {
      text: 'Supply the missing evidence named above for both periods, using matching definitions and complete coverage.',
      functionToInvolve: 'analytics',
      supportingRuleIds: ['traffic.change', 'conversion.change'],
    },
    {
      text: 'Avoid a technical repair until there is comparable evidence identifying what actually changed.',
      functionToInvolve: 'SEO',
      supportingRuleIds: ['traffic.change'],
    },
  ],
};

/**
 * Builds the next checks for a diagnosis, attaching only finding IDs that exist.
 * A template with no supporting finding is dropped rather than left pointing at
 * evidence that is not on the page.
 */
export function buildNextChecks(diagnosis: Diagnosis, findings: Finding[]): NextCheck[] {
  const byRuleId = new Map(findings.map((finding) => [finding.ruleId, finding.id]));

  return TEMPLATES[diagnosis]
    .map((template) => {
      const findingIds = template.supportingRuleIds
        .map((ruleId) => byRuleId.get(ruleId))
        .filter((id): id is string => id !== undefined);
      return { text: template.text, functionToInvolve: template.functionToInvolve, findingIds };
    })
    .filter((check) => check.findingIds.length > 0);
}
