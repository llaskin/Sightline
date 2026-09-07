import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  unique,
  index,
  foreignKey,
  date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

/**
 * Application tables.
 *
 * Every tenant-owned table carries `workspace_id` and a `(workspace_id, id)`
 * unique constraint, so child rows can use a *composite* foreign key. That
 * makes a cross-tenant relationship impossible in the database itself, not only
 * in the repository layer. Repository methods check scope as well; the
 * constraints are the second line of defence, not the only one.
 */

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** null means retain indefinitely until an owner deletes. */
  retentionDays: integer('retention_days'),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A user belongs to exactly one workspace in release 1; enforced by the PK. */
export const memberships = pgTable('memberships', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'analyst'] }).notNull(),
  active: text('active').notNull().default('true'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Stored as entered and normalised. Never fetched automatically. */
    domain: text('domain').notNull(),
    timeZone: text('time_zone').notNull(),
    definitions: jsonb('definitions').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('clients_workspace_id_id_key').on(table.workspaceId, table.id),
    index('clients_workspace_created_idx').on(table.workspaceId, table.createdAt, table.id),
  ],
);

export const complaints = pgTable(
  'complaints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    clientId: uuid('client_id').notNull(),
    originalText: text('original_text').notNull(),
    category: text('category').notNull(),
    scope: text('scope').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['open', 'analyzed', 'resolved'] })
      .notNull()
      .default('open'),
    revision: integer('revision').notNull().default(1),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('complaints_workspace_id_id_key').on(table.workspaceId, table.id),
    // The composite reference is what makes a cross-tenant complaint impossible.
    foreignKey({
      columns: [table.workspaceId, table.clientId],
      foreignColumns: [clients.workspaceId, clients.id],
      name: 'complaints_client_fk',
    }).onDelete('cascade'),
    index('complaints_workspace_created_idx').on(table.workspaceId, table.createdAt, table.id),
    index('complaints_client_idx').on(table.workspaceId, table.clientId),
  ],
);

export const importDrafts = pgTable(
  'import_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    clientId: uuid('client_id').notNull(),
    payload: jsonb('payload').notNull(),
    revision: integer('revision').notNull().default(1),
    /** Hash of the canonical validated content, checked again at commit. */
    contentHash: text('content_hash'),
    validation: jsonb('validation'),
    state: text('state', { enum: ['draft', 'validated', 'committed', 'deleted'] })
      .notNull()
      .default('draft'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('import_drafts_workspace_id_id_key').on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.clientId],
      foreignColumns: [clients.workspaceId, clients.id],
      name: 'import_drafts_client_fk',
    }).onDelete('cascade'),
    index('import_drafts_expiry_idx').on(table.expiresAt),
  ],
);

/**
 * Self-referencing predecessor links.
 *
 * Drizzle emits a plain `ON DELETE set null` for these composite foreign keys,
 * which PostgreSQL applies to *every* column in the key. That would try to set
 * `workspace_id` to NULL as well, and because that column is NOT NULL the
 * delete fails - blocking the legitimate removal of a superseded report or a
 * parent analysis. Verified against PostgreSQL 16.14:
 *
 *   ERROR: null value in column "ws" ... violates not-null constraint
 *   CONTEXT: UPDATE ONLY "t" SET "ws" = NULL, "parent" = NULL ...
 *
 * The checked-in migration therefore uses the PostgreSQL 15+ column-list form,
 * `ON DELETE SET NULL ("supersedes_report_id")`, which nulls only the link and
 * preserves ownership. If these tables are ever regenerated, reapply that edit;
 * `npm run test:integration` fails loudly if it is lost.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    clientId: uuid('client_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    reportLabel: text('report_label').notNull(),
    /** Immutable once written. A correction creates a new row. */
    snapshot: jsonb('snapshot').notNull(),
    /** Nullable and SET NULL on delete, so a predecessor can be removed. */
    supersedesReportId: uuid('supersedes_report_id'),
    contentHash: text('content_hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('reports_workspace_id_id_key').on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.clientId],
      foreignColumns: [clients.workspaceId, clients.id],
      name: 'reports_client_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.supersedesReportId],
      foreignColumns: [table.workspaceId, table.id],
      name: 'reports_supersedes_fk',
    }).onDelete('set null'),
    index('reports_workspace_created_idx').on(table.workspaceId, table.createdAt, table.id),
    index('reports_client_idx').on(table.workspaceId, table.clientId),
  ],
);

export const analyses = pgTable(
  'analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    clientId: uuid('client_id').notNull(),
    reportId: uuid('report_id').notNull(),
    complaintId: uuid('complaint_id').notNull(),
    parentAnalysisId: uuid('parent_analysis_id'),
    complaintSnapshot: jsonb('complaint_snapshot').notNull(),
    ruleVersion: text('rule_version').notNull(),
    resultSchemaVersion: integer('result_schema_version').notNull(),
    /** The saved result. Reads never recompute it. */
    result: jsonb('result').notNull(),
    diagnosis: text('diagnosis').notNull(),
    requestKey: text('request_key'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('analyses_workspace_id_id_key').on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.clientId],
      foreignColumns: [clients.workspaceId, clients.id],
      name: 'analyses_client_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.reportId],
      foreignColumns: [reports.workspaceId, reports.id],
      name: 'analyses_report_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.complaintId],
      foreignColumns: [complaints.workspaceId, complaints.id],
      name: 'analyses_complaint_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.parentAnalysisId],
      foreignColumns: [table.workspaceId, table.id],
      name: 'analyses_parent_fk',
    }).onDelete('set null'),
    index('analyses_workspace_created_idx').on(table.workspaceId, table.createdAt, table.id),
    index('analyses_client_idx').on(table.workspaceId, table.clientId),
    index('analyses_diagnosis_idx').on(table.workspaceId, table.diagnosis),
  ],
);

export const responseTemplates = pgTable(
  'response_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    isDefault: text('is_default').notNull().default('false'),
    revision: integer('revision').notNull().default(1),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('response_templates_workspace_id_id_key').on(table.workspaceId, table.id)],
);

export const responseRevisions = pgTable(
  'response_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    analysisId: uuid('analysis_id').notNull(),
    revision: integer('revision').notNull(),
    /** The template as it was when this revision was generated. */
    templateSnapshot: jsonb('template_snapshot').notNull(),
    generatedText: text('generated_text').notNull(),
    /** Null until a person edits. The generated text is always preserved. */
    editedText: text('edited_text'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('response_revisions_analysis_revision_key').on(table.analysisId, table.revision),
    foreignKey({
      columns: [table.workspaceId, table.analysisId],
      foreignColumns: [analyses.workspaceId, analyses.id],
      name: 'response_revisions_analysis_fk',
    }).onDelete('cascade'),
  ],
);

/** Actions only. Never complaint text, report rows or credentials. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_workspace_created_idx').on(table.workspaceId, table.createdAt)],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    requestKey: text('request_key').notNull(),
    /** Same key with a different body is a conflict, not a replay. */
    requestHash: text('request_hash').notNull(),
    resultId: uuid('result_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('idempotency_workspace_operation_key').on(
      table.workspaceId,
      table.operation,
      table.requestKey,
    ),
  ],
);

export const NOW_SQL = sql`now()`;
