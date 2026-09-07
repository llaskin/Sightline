import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { pageMembership } from '@/server/page-data';
import { getDb } from '@/server/db/client';
import { analyses, clients } from '@/server/db/schema';
import { Card, EmptyState } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

/**
 * Redirects to a concrete saved analysis when one exists, so the dashboard is
 * always showing a real stored result rather than a synthesised summary.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const membership = await pageMembership();
  const { clientId } = await searchParams;
  const db = getDb();

  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, membership.workspaceId), isNull(clients.archivedAt)))
    .orderBy(desc(clients.createdAt))
    .limit(50);

  if (clientRows.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <h1 className="mb-1 text-[28px] font-semibold text-ink">Dashboard</h1>
        <p className="mb-6 text-[13px] text-ink-muted">
          SEO performance and lead-generation evidence
        </p>
        <Card>
          <EmptyState
            title="Add a client to begin"
            description="Create a client, import two comparable reporting periods, then record the complaint you want to examine. Nothing here is generated until you supply real data."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/clients?new=1" variant="primary">
                  Add a client
                </ButtonLink>
                <ButtonLink href="/demo">Explore demo</ButtonLink>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const selected = clientRows.find((client) => client.id === clientId) ?? clientRows[0];

  const latest = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(
      and(eq(analyses.workspaceId, membership.workspaceId), eq(analyses.clientId, selected.id)),
    )
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (latest[0]) redirect(`/analyses/${latest[0].id}`);

  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="mb-1 text-[28px] font-semibold text-ink">Dashboard</h1>
      <p className="mb-6 text-[13px] text-ink-muted">
        SEO performance and lead-generation evidence
      </p>
      <Card>
        <EmptyState
          title={`No analysis yet for ${selected.name}`}
          description="Import a report covering two comparable periods, record the client's complaint in their own words, then create an analysis. The dashboard fills in from that saved result."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={`/reports/new?clientId=${selected.id}`} variant="primary">
                Import a report
              </ButtonLink>
              <ButtonLink href={`/analyses/new?clientId=${selected.id}`}>New Analysis</ButtonLink>
            </div>
          }
        />
      </Card>
      {clientRows.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {clientRows.map((client) => (
            <Link
              key={client.id}
              href={`/dashboard?clientId=${client.id}`}
              className="rounded-[8px] border border-line px-3 py-2 text-[12px] text-ink-muted hover:text-ink"
            >
              {client.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
