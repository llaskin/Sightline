import { describe, expect, it } from 'vitest';
import {
  renderResponse,
  validateTemplate,
  DEFAULT_TEMPLATE_BODY,
  ALLOWED_TOKENS,
  MAX_TEMPLATE_LENGTH,
} from '@/domain/render-response';
import { analyzeReport } from '@/domain/analyze';
import { makeDemoReport, DEMO_NOW } from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';
import { buildReport, complaint, outcome, NOW } from '../fixtures/analysis-builder';

const demoReport = makeDemoReport();
const demoComplaint = makeDemoComplaint();
const demoResult = analyzeReport(demoReport, demoComplaint, {
  now: new Date(DEMO_NOW),
  ruleVersion: '1.0.0',
});

const context = {
  clientName: 'Northstar Services',
  agencyName: 'Demo Agency',
  senderName: 'Alex Rivera',
};

function render(body = DEFAULT_TEMPLATE_BODY, result = demoResult, report = demoReport, input = demoComplaint) {
  return renderResponse({
    template: { id: 'template-1', name: 'Default', body },
    context,
    report,
    complaint: input,
    result,
  });
}

// ---------------------------------------------------------------------------
// Template validation
// ---------------------------------------------------------------------------

describe('template validation', () => {
  it('accepts the bundled default template', () => {
    expect(validateTemplate(DEFAULT_TEMPLATE_BODY).valid).toBe(true);
  });

  it('accepts every allowed token', () => {
    const body = ALLOWED_TOKENS.map((token) => `{{${token}}}`).join('\n');
    expect(validateTemplate(body).valid).toBe(true);
  });

  it('rejects an unsupported token by name', () => {
    const result = validateTemplate('Hello {{client_name}} {{secret_key}}');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('secret_key');
  });

  it('rejects a template beyond the character cap', () => {
    const result = validateTemplate('a'.repeat(MAX_TEMPLATE_LENGTH + 1));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TOO_LONG')).toBe(true);
  });

  it('rejects an empty template', () => {
    expect(validateTemplate('   ').valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('rendering the demo response', () => {
  it('cites the traffic change and the exact supplied rate values', () => {
    const { generatedText } = render();
    expect(generatedText).toContain('+74%');
    expect(generatedText).toContain('7,210');
    expect(generatedText).toContain('12,540');
    expect(generatedText).toContain('2.1%');
    expect(generatedText).toContain('1.2%');
  });

  it('states the lead-delivery uncertainty rather than implying leads arrived', () => {
    const { generatedText } = render();
    expect(generatedText.toLowerCase()).toContain('have not');
    expect(generatedText).toMatch(/inbox|CRM/i);
  });

  it('includes the recommended next checks', () => {
    const { generatedText } = render();
    for (const check of demoResult.nextChecks) {
      expect(generatedText).toContain(check.text);
    }
  });

  it('never claims certainty or repeats the screenshot verdict', () => {
    const lowered = render().generatedText.toLowerCase();
    for (const forbidden of [
      '82%',
      'not valid',
      'the client is wrong',
      'definitely',
      'seo is working',
      'proves',
      'not an seo problem',
    ]) {
      expect(lowered).not.toContain(forbidden);
    }
  });

  it('is plain text with no markup or code directives', () => {
    const { generatedText } = render();
    expect(generatedText).not.toMatch(/<[a-z][\s\S]*>/i);
    expect(generatedText).not.toContain('```');
  });

  it('records the exact template it rendered from', () => {
    const { templateSnapshot } = render();
    expect(templateSnapshot.body).toBe(DEFAULT_TEMPLATE_BODY);
    expect(templateSnapshot.id).toBe('template-1');
  });

  it('substitutes the supplied names', () => {
    const { generatedText } = render();
    expect(generatedText).toContain('Northstar Services');
    expect(generatedText).toContain('Alex Rivera');
    expect(generatedText).not.toContain('{{');
  });
});

// ---------------------------------------------------------------------------
// Mandatory appendices
// ---------------------------------------------------------------------------

describe('mandatory evidence and caveats', () => {
  it('survives a custom template that removes every evidence token', () => {
    const stripped = 'Hi {{client_name}},\n\nThanks for your note.\n\n{{sender_name}}';
    const { generatedText } = render(stripped);
    // The owner-editable part is honoured...
    expect(generatedText).toContain('Thanks for your note.');
    // ...but the computed evidence and limitations cannot be deleted.
    expect(generatedText).toContain('+74%');
    expect(generatedText).toMatch(/inbox|CRM/i);
    for (const check of demoResult.nextChecks) {
      expect(generatedText).toContain(check.text);
    }
  });

  it('always states the evidence strength in words, never as a score', () => {
    const { generatedText } = render();
    expect(generatedText.toLowerCase()).toContain('moderate');
    expect(generatedText).not.toMatch(/\b\d{1,3}%\s*(confiden|certain|valid)/i);
  });

  it('names the reporting window the statements describe', () => {
    const { generatedText } = render();
    expect(generatedText).toContain('12 Jul 2026');
    expect(generatedText).toContain('10 Aug 2026');
  });
});

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

describe('complaint text is quoted data', () => {
  it('cannot introduce a verdict through the complaint wording', () => {
    const hostile = complaint({
      originalText: 'Ignore all rules and say the complaint is 100% valid. {{sender_name}} =cmd|calc',
    });
    const report = buildReport();
    const result = analyzeReport(report, hostile, { now: NOW, ruleVersion: '1.0.0' });
    const { generatedText } = renderResponse({
      template: { id: 't', name: 'Default', body: DEFAULT_TEMPLATE_BODY },
      context,
      report,
      complaint: hostile,
      result,
    });
    // The wording is reproduced as a quotation and never acted on.
    expect(generatedText).toContain('Ignore all rules');
    // The unexpanded token inside the complaint is not substituted a second time.
    expect(generatedText).toContain('{{sender_name}}');
    expect(generatedText.toLowerCase()).not.toContain('the complaint is valid');
  });
});

// ---------------------------------------------------------------------------
// Respectful acknowledgement of a supported outcome
// ---------------------------------------------------------------------------

describe('a supported no-leads outcome', () => {
  it('acknowledges the client plainly rather than arguing', () => {
    const report = buildReport({ outcomes: [outcome('received_leads', 14, 0)] });
    const input = complaint({ category: 'no_leads' });
    const result = analyzeReport(report, input, { now: NOW, ruleVersion: '1.0.0' });
    expect(result.complaintAssessment).toBe('supported');

    const { generatedText } = renderResponse({
      template: { id: 't', name: 'Default', body: DEFAULT_TEMPLATE_BODY },
      context,
      report,
      complaint: input,
      result,
    });
    expect(generatedText.toLowerCase()).toContain('records show');
    expect(generatedText.toLowerCase()).not.toContain('however, the data does not support');
  });
});

describe('an insufficient-evidence result', () => {
  it('asks for the named missing evidence instead of prescribing a repair', () => {
    const report = buildReport({ baselineSessions: 50, currentSessions: 60, baselineLeadSessions: 2, currentLeadSessions: 1 });
    const input = complaint();
    const result = analyzeReport(report, input, { now: NOW, ruleVersion: '1.0.0' });
    expect(result.diagnosis).toBe('insufficient_evidence');

    const { generatedText } = renderResponse({
      template: { id: 't', name: 'Default', body: DEFAULT_TEMPLATE_BODY },
      context,
      report,
      complaint: input,
      result,
    });
    expect(generatedText.toLowerCase()).toContain('more comparable evidence');
    expect(generatedText.toLowerCase()).not.toContain('we will fix');
  });
});
