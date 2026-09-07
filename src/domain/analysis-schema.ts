import { z } from 'zod';
import { periodSchema } from './report-schema';

/**
 * Result contract for one immutable analysis. Deliberately absent: any validity
 * percentage, confidence score or causal certainty. Release 1 reports what the
 * evidence supports and what it cannot establish.
 */

export const diagnosisSchema = z.enum([
  'measurement_issue',
  'insufficient_evidence',
  'mixed',
  'search_acquisition',
  'post_click',
  'no_clear_issue',
]);

export const assessmentSchema = z.enum(['supported', 'contradicted', 'unverified']);
export const evidenceStrengthSchema = z.enum(['limited', 'moderate']);
export const directionSchema = z.enum(['up', 'down', 'flat', 'unknown']);

/**
 * A comparison outcome. `new`, `no_activity` and `unavailable` are distinct
 * states that must never collapse into a number, a zero or NaN.
 */
export const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('relative'), percent: z.number(), absolute: z.number() }),
  z.object({ kind: z.literal('new'), absolute: z.number() }),
  z.object({ kind: z.literal('no_activity'), absolute: z.literal(0) }),
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
]);

export const evidenceRefSchema = z.object({
  dataset: z.string(),
  period: periodSchema.nullable(),
  rowKey: z.string(),
});

export const findingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  statementKey: z.string(),
  text: z.string(),
  direction: directionSchema,
  /** Unrounded values, kept so exports and drawers can show the real arithmetic. */
  values: z.record(z.string(), z.number().nullable()),
  unit: z.string(),
  sources: z.array(evidenceRefSchema),
  eligible: z.boolean(),
  caveats: z.array(z.string()),
});

export const nextCheckSchema = z.object({
  text: z.string(),
  functionToInvolve: z.enum(['SEO', 'web development', 'analytics', 'sales operations']),
  findingIds: z.array(z.string()),
});

export const analysisResultSchema = z.object({
  schemaVersion: z.literal(1),
  ruleVersion: z.literal('1.0.0'),
  diagnosis: diagnosisSchema,
  headline: z.string(),
  complaintAssessment: assessmentSchema,
  assessmentReason: z.string(),
  evidenceStrength: evidenceStrengthSchema,
  strengthReasons: z.array(z.string()),
  /** Which of the four investigation areas the evidence points at. Never a percentage. */
  investigationFocus: z.enum(['measurement', 'search_acquisition', 'post_click', 'mixed_or_unclear']),
  findings: z.array(findingSchema),
  gaps: z.array(z.string()),
  nextChecks: z.array(nextCheckSchema),
  periodAlignment: z.enum(['aligned', 'mismatched']),
});

export type Diagnosis = z.infer<typeof diagnosisSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type Change = z.infer<typeof changeSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type NextCheck = z.infer<typeof nextCheckSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const RULE_VERSION = '1.0.0' as const;
export const RESULT_SCHEMA_VERSION = 1 as const;

/** Headlines are fixed per diagnosis so wording can never drift into a verdict. */
export const DIAGNOSIS_HEADLINES: Record<Diagnosis, string> = {
  measurement_issue: 'Resolve measurement problems before attributing the change',
  insufficient_evidence: 'More comparable evidence is needed',
  mixed: 'Search acquisition and post-click performance both need investigation',
  search_acquisition: 'Investigate search visibility and traffic quality',
  post_click: 'Evidence points to a post-click investigation',
  no_clear_issue: 'No clear issue is established by the supplied report',
};

export const DIAGNOSIS_FOCUS: Record<Diagnosis, AnalysisResult['investigationFocus']> = {
  measurement_issue: 'measurement',
  insufficient_evidence: 'mixed_or_unclear',
  mixed: 'mixed_or_unclear',
  search_acquisition: 'search_acquisition',
  post_click: 'post_click',
  no_clear_issue: 'mixed_or_unclear',
};
