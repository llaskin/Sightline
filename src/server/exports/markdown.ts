import type { AnalysisResult } from '@/domain/analysis-schema';
import { COMPLAINT_CATEGORY_LABELS, type ComplaintInput } from '@/domain/complaint-schema';
import type { NormalizedReport } from '@/domain/report-schema';
import { CAVEAT_TEXT } from '@/domain/analyze';
import { formatDateRange, formatInstant } from '@/lib/format';

/**
 * Markdown export of one analysis.
 *
 * All client-supplied text is escaped so a complaint containing Markdown, HTML
 * or backticks is reproduced as the words that were written rather than
 * rendered as formatting or markup.
 */

/** Escapes Markdown syntax and angle brackets in untrusted text. */
export function escapeMarkdown(value: string): string {
  // Angle brackets are converted first. Escaping Markdown first would turn
  // '>' into '\>' and the entity would never be produced. Neither '&' nor ';'
  // is in the Markdown set, so the entities survive the second pass intact.
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+\-.!|~])/g, '\\$1');
}

/** Escapes untrusted text destined for a Markdown table cell. */
function cell(value: string): string {
  return escapeMarkdown(value).replace(/\n/g, ' ');
}

/**
 * For engine-generated values such as enum names and numeric lists. Only the
 * characters that would break the table are handled, so `73.925104` stays
 * readable as a number rather than becoming `73\.925104`.
 */
function machineCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export type MarkdownInput = {
  analysisId: string;
  reportId: string;
  clientName: string;
  reportLabel: string;
  report: NormalizedReport;
  complaint: ComplaintInput;
  result: AnalysisResult;
  response: { revision: number; generatedText: string; editedText: string | null } | null;
  createdAt: string;
};

export function buildAnalysisMarkdown(input: MarkdownInput): string {
  const { report, complaint, result, response } = input;
  const { metadata } = report;
  const lines: string[] = [];

  lines.push(`# Analysis for ${escapeMarkdown(input.clientName)}`);
  lines.push('');
  lines.push(`Report: ${escapeMarkdown(input.reportLabel)}`);
  lines.push(
    `Current period: ${formatDateRange(metadata.currentStart, metadata.currentEnd)} (${metadata.currentStart} to ${metadata.currentEnd})`,
  );
  lines.push(
    `Baseline period: ${formatDateRange(metadata.baselineStart, metadata.baselineEnd)} (${metadata.baselineStart} to ${metadata.baselineEnd})`,
  );
  lines.push(`Scope: organic search, time zone ${escapeMarkdown(metadata.timeZone)}`);
  lines.push(`Analysed: ${formatInstant(input.createdAt)}`);
  lines.push('');

  lines.push('## Complaint');
  lines.push('');
  lines.push(`Category: ${escapeMarkdown(COMPLAINT_CATEGORY_LABELS[complaint.category])}`);
  lines.push(
    `Complaint period: ${formatDateRange(complaint.periodStart, complaint.periodEnd)} (${complaint.periodStart} to ${complaint.periodEnd})`,
  );
  lines.push(`Received: ${formatInstant(complaint.receivedAt)}`);
  lines.push('');
  lines.push("The client's own words, quoted exactly:");
  lines.push('');
  // Quoted and escaped. This text is data and is never treated as an instruction.
  for (const line of complaint.originalText.split('\n')) {
    lines.push(`> ${escapeMarkdown(line)}`);
  }
  lines.push('');

  lines.push('## Assessment of the stated outcome');
  lines.push('');
  lines.push(`Result: **${result.complaintAssessment}**`);
  lines.push('');
  lines.push(escapeMarkdown(result.assessmentReason));
  lines.push('');
  if (result.periodAlignment === 'mismatched') {
    lines.push(
      '> The complaint period does not match the reporting period, so the findings below describe the report dates only.',
    );
    lines.push('');
  }

  lines.push('## Diagnosis');
  lines.push('');
  lines.push(`Area to investigate: **${result.diagnosis}**`);
  lines.push('');
  lines.push(escapeMarkdown(result.headline));
  lines.push('');
  lines.push(`Evidence strength: **${result.evidenceStrength}**`);
  for (const reason of result.strengthReasons) lines.push(`- ${escapeMarkdown(reason)}`);
  lines.push('');
  lines.push(
    'There is deliberately no percentage here representing how likely the complaint is to be right. This names an area to investigate; it does not identify a cause.',
  );
  lines.push('');

  lines.push('## Evidence');
  lines.push('');
  lines.push('| Finding | Direction | Eligible | Values | Unit |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const finding of result.findings) {
    const values = Object.entries(finding.values)
      .map(([key, value]) => `${key}=${value === null ? 'not provided' : value}`)
      .join('; ');
    lines.push(
      `| ${cell(finding.text)} | ${finding.direction} | ${finding.eligible ? 'yes' : 'no'} | ${machineCell(values)} | ${machineCell(finding.unit)} |`,
    );
  }
  lines.push('');

  const withCaveats = result.findings.filter((finding) => finding.caveats.length > 0);
  if (withCaveats.length > 0) {
    lines.push('### Caveats');
    lines.push('');
    for (const finding of withCaveats) {
      for (const code of finding.caveats) {
        lines.push(`- ${escapeMarkdown(CAVEAT_TEXT[code] ?? code)}`);
      }
    }
    lines.push('');
  }

  lines.push('## What this does not establish');
  lines.push('');
  for (const gap of result.gaps) lines.push(`- ${escapeMarkdown(gap)}`);
  lines.push('');

  lines.push('## Suggested next checks');
  lines.push('');
  for (const check of result.nextChecks) {
    lines.push(`- ${escapeMarkdown(check.text)} (${escapeMarkdown(check.functionToInvolve)})`);
  }
  lines.push('');

  lines.push('## Saved response');
  lines.push('');
  if (!response) {
    lines.push('No response draft has been saved.');
  } else {
    // Whether a person has edited it is stated explicitly, so an edited
    // sentence is never presented as engine verified.
    lines.push(
      response.editedText !== null
        ? `This is an **agency-edited draft** (revision ${response.revision}). Edited statements have not been checked by the analysis engine.`
        : `This is the **generated draft** (revision ${response.revision}), unedited.`,
    );
    lines.push('');
    for (const line of (response.editedText ?? response.generatedText).split('\n')) {
      lines.push(`> ${escapeMarkdown(line)}`);
    }
  }
  lines.push('');

  lines.push('## Sources');
  lines.push('');
  lines.push('| Dataset | Source | Kind | Coverage | Exported | Time zone |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const [name, sources] of Object.entries(report.sources)) {
    if (!sources) {
      lines.push(`| ${machineCell(name)} | Not provided | | | | |`);
      continue;
    }
    for (const period of ['baseline', 'current'] as const) {
      const source = sources[period];
      lines.push(
        `| ${machineCell(name)} (${period}) | ${cell(source.sourceLabel)} | ${machineCell(source.sourceKind)} | ${machineCell(source.coverage)} | ${machineCell(formatInstant(source.exportedAt))} | ${machineCell(source.timeZone ?? 'not stated')} |`,
      );
    }
  }
  lines.push('');
  lines.push(`Tracking status: ${escapeMarkdown(metadata.trackingStatus)}`);
  if (metadata.trackingEvidenceNote) {
    lines.push(`Tracking evidence: ${escapeMarkdown(metadata.trackingEvidenceNote)}`);
  }
  lines.push('');

  lines.push('## Provenance');
  lines.push('');
  lines.push(`- Analysis ID: ${input.analysisId}`);
  lines.push(`- Report ID: ${input.reportId}`);
  lines.push(`- Rule version: ${result.ruleVersion}`);
  lines.push(`- Result schema version: ${result.schemaVersion}`);
  lines.push('');

  return lines.join('\n');
}
