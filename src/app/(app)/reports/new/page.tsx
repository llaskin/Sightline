import { pageMembership } from '@/server/page-data';
import { clientDefinitionsSchema, listClients } from '@/server/repositories/clients';
import { findDraft, toDraftView } from '@/server/repositories/imports';
import { findReport } from '@/server/repositories/reports';
import { DEFAULT_LIMITS } from '@/features/imports/csv';
import type { NormalizedReport } from '@/domain/report-schema';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import {
  ImportWizard,
  type DraftView,
  type MetadataValue,
  type WizardClient,
} from '@/features/imports/import-wizard';

export const dynamic = 'force-dynamic';

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; draftId?: string; supersedes?: string }>;
}) {
  const membership = await pageMembership();
  const { clientId, draftId, supersedes } = await searchParams;

  const clientPage = await listClients(membership, { limit: 100, cursor: null });
  const clients: WizardClient[] = clientPage.items.map((row) => {
    const definitions = clientDefinitionsSchema.parse(row.definitions ?? {});
    return {
      id: row.id,
      name: row.name,
      timeZone: row.timeZone,
      propertyLabel: definitions.propertyLabel,
      leadDefinition: definitions.leadDefinition,
      leadEventName: definitions.leadEventName,
    };
  });

  if (clients.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <h1 className="mb-1 text-[28px] font-semibold text-ink">Import a report</h1>
        <Card className="mt-5">
          <EmptyState
            title="No client to import for"
            description="A report belongs to a client, so add one first. An archived client cannot receive a new import until it is restored."
            action={
              <ButtonLink href="/clients?new=1" variant="primary">
                Add a client
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  let initialDraft: DraftView | null = null;
  if (draftId) {
    const row = await findDraft(membership, draftId);
    if (!row || row.state === 'deleted') {
      return (
        <div className="mx-auto max-w-2xl py-10">
          <h1 className="mb-1 text-[28px] font-semibold text-ink">Import a report</h1>
          <Card className="mt-5">
            <EmptyState
              title="That draft is no longer available"
              description="It was discarded, it expired, or it belongs to another workspace. Nothing was committed from it."
              action={
                <ButtonLink href="/reports/new" variant="primary">
                  Start a new import
                </ButtonLink>
              }
            />
          </Card>
        </div>
      );
    }
    if (row.state === 'committed') {
      return (
        <div className="mx-auto max-w-2xl py-10">
          <h1 className="mb-1 text-[28px] font-semibold text-ink">Import a report</h1>
          <Card className="mt-5">
            <EmptyState
              title="That draft has already been committed"
              description="A committed report is immutable, so this draft cannot be reopened. Import a new report if a correction is needed."
              action={
                <ButtonLink href="/reports/new" variant="primary">
                  Start a new import
                </ButtonLink>
              }
            />
          </Card>
        </div>
      );
    }
    initialDraft = toDraftView(row) as unknown as DraftView;
  }

  // A correction carries the predecessor's identifier and reuses its stated
  // metadata, so the two reports describe the same windows and definitions.
  let prefillMetadata: MetadataValue | null = null;
  let supersedesReportId: string | null = null;
  // A resumed draft carries its predecessor in the payload, so reopening it
  // does not quietly turn a correction into an unrelated new report.
  const predecessorId = supersedes ?? initialDraft?.payload?.supersedesReportId ?? null;
  if (predecessorId) {
    const predecessor = await findReport(membership, predecessorId);
    if (predecessor) {
      supersedesReportId = predecessor.id;
      const snapshot = predecessor.snapshot as NormalizedReport;
      prefillMetadata = {
        ...snapshot.metadata,
        reportLabel: `${snapshot.metadata.reportLabel} (corrected)`,
        channel: 'organic_search',
      };
    }
  }

  // Rendered on the server on every request, so the clock is read once here
  // rather than being inferred from stale build-time state.
  const renderedAt = new Date();
  const expiresAt = initialDraft ? new Date(initialDraft.expiresAt) : null;
  const expired = expiresAt !== null && expiresAt.getTime() <= renderedAt.getTime();

  return (
    <>
      {expired ? (
        <div className="mx-auto max-w-5xl pt-6">
          <Card className="border-caution/40">
            <CardHeader title="This draft has expired" />
            <p className="px-4 pb-4 text-[13px] leading-relaxed text-ink-muted">
              A draft is kept for seven days. This one is past that, so a commit will be refused.
              Discard it and start again; nothing was committed from it.
            </p>
          </Card>
        </div>
      ) : null}
      <ImportWizard
        clients={clients}
        initialClientId={clientId ?? initialDraft?.clientId ?? null}
        initialDraft={initialDraft}
        prefillMetadata={prefillMetadata}
        supersedesReportId={supersedesReportId}
        limits={{
          maxBytes: DEFAULT_LIMITS.maxBytes,
          maxRows: DEFAULT_LIMITS.maxRows,
          maxReportedErrors: DEFAULT_LIMITS.maxReportedErrors,
        }}
      />
    </>
  );
}
