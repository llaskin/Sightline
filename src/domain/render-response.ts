import type { AnalysisResult } from './analysis-schema';
import type { ComplaintInput } from './complaint-schema';
import type { NormalizedReport } from './report-schema';
import { formatDateRange, formatCount, formatRate, formatWholePercent } from '@/lib/format';

/**
 * Deterministic response drafting. There is no model, no code evaluation, and
 * no HTML or Markdown interpretation: a template is a plain string with a fixed
 * set of substitution tokens, and everything else is generated from findings
 * the engine already approved.
 */

export const ALLOWED_TOKENS = [
  'client_name',
  'agency_name',
  'current_period',
  'baseline_period',
  'complaint_summary',
  'evidence_summary',
  'caveats',
  'next_steps',
  'sender_name',
] as const;

export type AllowedToken = (typeof ALLOWED_TOKENS)[number];

export const MAX_TEMPLATE_LENGTH = 10_000;

export const DEFAULT_TEMPLATE_BODY = `Hi {{client_name}},

Thanks for raising this. I have compared {{current_period}} against {{baseline_period}} and want to share what the report does and does not show.

You told us: {{complaint_summary}}

{{evidence_summary}}

{{caveats}}

{{next_steps}}

I would rather agree the next steps with you than assume them, so tell me which of these you want us to start with.

Best regards,
{{sender_name}}
{{agency_name}}`;

export type TemplateValidation = {
  valid: boolean;
  errors: Array<{ code: string; message: string }>;
};

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function validateTemplate(body: string): TemplateValidation {
  const errors: TemplateValidation['errors'] = [];

  if (body.trim().length === 0) {
    errors.push({ code: 'EMPTY', message: 'The template cannot be empty' });
  }
  if (body.length > MAX_TEMPLATE_LENGTH) {
    errors.push({
      code: 'TOO_LONG',
      message: `The template is ${body.length} characters; the limit is ${MAX_TEMPLATE_LENGTH}`,
    });
  }

  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!ALLOWED_TOKENS.includes(token as AllowedToken)) {
      errors.push({
        code: 'UNSUPPORTED_TOKEN',
        message: `"${token}" is not a supported token. Supported tokens: ${ALLOWED_TOKENS.join(', ')}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export type RenderContext = {
  clientName: string;
  agencyName: string;
  senderName: string;
};

export type TemplateSnapshot = { id: string; name: string; body: string };

export type RenderInput = {
  template: TemplateSnapshot;
  context: RenderContext;
  report: NormalizedReport;
  complaint: ComplaintInput;
  result: AnalysisResult;
};

const STRENGTH_SENTENCE: Record<AnalysisResult['evidenceStrength'], string> = {
  limited:
    'The supporting evidence here is limited: it comes from a single source, so treat this as a direction to investigate rather than a settled answer.',
  moderate:
    'The supporting evidence here is moderate: two independent sources point the same way. That still indicates where to look, not what caused it.',
};

const ASSESSMENT_SENTENCE: Record<AnalysisResult['complaintAssessment'], string> = {
  supported: 'The records show your account of what happened is borne out by the evidence we have.',
  contradicted:
    'The records we hold read differently, and it is worth going through them together in case we are measuring different things.',
  unverified:
    'We cannot confirm or rule out that outcome from this report, because the evidence that would settle it was not available.',
};

/** Builds the evidence paragraph from findings the engine already approved. */
function evidenceSummary(report: NormalizedReport, result: AnalysisResult): string {
  const lines: string[] = [];
  const byRule = new Map(result.findings.map((finding) => [finding.ruleId, finding]));

  const traffic = byRule.get('traffic.change');
  if (traffic) {
    lines.push(
      `Organic sessions: ${formatCount(traffic.values.baselineSessions)} to ${formatCount(traffic.values.currentSessions)} (${formatWholePercent(traffic.values.percent)}).`,
    );
  }

  const conversion = byRule.get('conversion.change');
  if (conversion && conversion.values.baselineRate !== null && conversion.values.currentRate !== null) {
    lines.push(
      `Tracked lead-session rate: ${formatRate(conversion.values.baselineRate)} to ${formatRate(conversion.values.currentRate)} ` +
        `(${formatWholePercent(conversion.values.percent)}). A lead session is a session containing the lead action, not a lead that reached you.`,
    );
  }

  const rank = byRule.get('rank.top10');
  if (rank && rank.eligible && rank.values.netTop10Change !== null) {
    lines.push(
      `Tracked commercial keywords in the top 10: ${rank.values.baselineTop10} to ${rank.values.currentTop10} ` +
        `(${rank.values.netTop10Change >= 0 ? '+' : ''}${rank.values.netTop10Change} across the same tracked terms).`,
    );
  }

  const form = byRule.get('form.failureRate');
  if (form && form.values.baselineFailureRate !== null && form.values.currentFailureRate !== null) {
    lines.push(
      `Contact form failure rate: ${formatRate(form.values.baselineFailureRate)} to ${formatRate(form.values.currentFailureRate)}.`,
    );
  }

  for (const finding of result.findings) {
    if (finding.ruleId.startsWith('outcome.')) lines.push(finding.text);
  }

  const heading = `Here is what the report shows for ${formatDateRange(report.metadata.currentStart, report.metadata.currentEnd)}, for organic search:`;
  return [heading, ...lines.map((line) => `- ${line}`), '', result.headline + '.'].join('\n');
}

function caveatsParagraph(result: AnalysisResult): string {
  const lines = [ASSESSMENT_SENTENCE[result.complaintAssessment], '', 'What this does not establish:'];

  // Stated plainly, because a tracked action is not a delivered lead and the
  // difference is exactly what the client is asking about.
  if (result.gaps.some((gap) => gap.includes('received-lead'))) {
    lines.push(
      '- We have not reconciled these tracked actions against your inbox or CRM, so we cannot yet say how many leads actually reached you.',
    );
  }
  for (const gap of result.gaps) lines.push(`- ${gap}`);
  lines.push(`- ${STRENGTH_SENTENCE[result.evidenceStrength]}`);
  lines.push(
    '- More sessions on their own do not establish that the traffic is more relevant. This points to an area to investigate, does not identify a cause, and contains no figure representing how likely the complaint is to be right.',
  );
  return lines.join('\n');
}

function nextStepsParagraph(result: AnalysisResult): string {
  if (result.nextChecks.length === 0) return 'Suggested next checks: none can be recommended from this evidence.';
  const lines = ['Suggested next checks:'];
  for (const check of result.nextChecks) {
    lines.push(`- ${check.text} (${check.functionToInvolve})`);
  }
  return lines.join('\n');
}

/**
 * Substitutes tokens exactly once. Values are inserted after the scan, so text
 * that arrives inside a value, such as a complaint quoting `{{sender_name}}`,
 * is never expanded a second time.
 */
function substitute(body: string, values: Record<AllowedToken, string>): string {
  return body.replace(TOKEN_PATTERN, (match, token: string) =>
    ALLOWED_TOKENS.includes(token as AllowedToken) ? values[token as AllowedToken] : match,
  );
}

export function renderResponse(input: RenderInput): {
  generatedText: string;
  templateSnapshot: TemplateSnapshot;
} {
  const { template, context, report, complaint, result } = input;

  const evidence = evidenceSummary(report, result);
  const caveats = caveatsParagraph(result);
  const nextSteps = nextStepsParagraph(result);

  const values: Record<AllowedToken, string> = {
    client_name: context.clientName,
    agency_name: context.agencyName,
    sender_name: context.senderName,
    current_period: formatDateRange(report.metadata.currentStart, report.metadata.currentEnd),
    baseline_period: formatDateRange(report.metadata.baselineStart, report.metadata.baselineEnd),
    // The client's own words, quoted and never acted on.
    complaint_summary: `“${complaint.originalText}”`,
    evidence_summary: evidence,
    caveats,
    next_steps: nextSteps,
  };

  const body = substitute(template.body, values);

  // These paragraphs sit outside the owner-editable template, so deleting a
  // token cannot hide the evidence or the limitations from the generated draft.
  const mandatory: string[] = [];
  if (!template.body.includes('{{evidence_summary}}')) mandatory.push(evidence);
  // The caveats block opens with the outcome assessment, so a template that
  // keeps {{caveats}} carries it in a sensible position rather than after the
  // signature.
  if (!template.body.includes('{{caveats}}')) mandatory.push(caveats);
  if (!template.body.includes('{{next_steps}}')) mandatory.push(nextSteps);

  const generatedText = [body.trimEnd(), '', ...mandatory].join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd();

  return { generatedText, templateSnapshot: { ...template } };
}
