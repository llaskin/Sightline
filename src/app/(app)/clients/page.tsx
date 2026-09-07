import Link from 'next/link';
import { pageMembership } from '@/server/page-data';
import {
  clientDefinitionsSchema,
  listClients,
  type ClientRecord,
} from '@/server/repositories/clients';
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import {
  CreateClientPanel,
  ClientArchiveButton,
  type ClientView,
} from '@/features/clients/client-form';

export const dynamic = 'force-dynamic';

/** The stored definitions column is untyped JSON, so it is parsed on the way out. */
function toView(row: ClientRecord): ClientView {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    timeZone: row.timeZone,
    definitions: clientDefinitionsSchema.parse(row.definitions ?? {}),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    revision: row.revision,
  };
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; archived?: string }>;
}) {
  const membership = await pageMembership();
  const { new: newParam, archived: archivedParam } = await searchParams;
  const showArchived = archivedParam === '1';

  const page = await listClients(membership, { limit: 100, cursor: null, includeArchived: true });
  const all = page.items.map(toView);
  const active = all.filter((client) => client.archivedAt === null);
  const archived = all.filter((client) => client.archivedAt !== null);

  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold text-ink">Clients</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            One record per client, holding the domain, reporting time zone and the definitions every
            imported report repeats.
          </p>
        </div>
        <CreateClientPanel initiallyOpen={newParam === '1'} />
      </div>

      <Card>
        <CardHeader title={`Active clients (${active.length})`} />
        {active.length === 0 ? (
          <EmptyState
            title="No active clients"
            description="Add a client before importing a report. Nothing on the dashboard exists until a client and a report do."
          />
        ) : (
          <ul className="divide-y divide-line">
            {active.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/clients/${client.id}`}
                    className="text-[14px] font-medium text-ink hover:text-[#a99bff]"
                  >
                    {client.name}
                  </Link>
                  <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                    {client.domain} &middot; {client.timeZone}
                  </p>
                </div>
                <ButtonLink href={`/reports/new?clientId=${client.id}`}>Import a report</ButtonLink>
                <ClientArchiveButton client={client} role={membership.role} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4">
        <Link
          href={showArchived ? '/clients' : '/clients?archived=1'}
          className="inline-flex min-h-[44px] items-center rounded-[10px] border border-line px-3 text-[13px] text-ink-muted hover:text-ink"
          aria-expanded={showArchived}
        >
          {showArchived
            ? 'Hide archived clients'
            : `Show archived clients (${archived.length})`}
        </Link>
      </div>

      {showArchived ? (
        <Card className="mt-4">
          <CardHeader title={`Archived clients (${archived.length})`} />
          {archived.length === 0 ? (
            <EmptyState
              title="No archived clients"
              description="Archiving keeps a client's history readable while blocking new imports, complaints and analyses."
            />
          ) : (
            <ul className="divide-y divide-line">
              {archived.map((client) => (
                <li key={client.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/clients/${client.id}`}
                      className="text-[14px] font-medium text-ink hover:text-[#a99bff]"
                    >
                      {client.name}
                    </Link>
                    <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                      {client.domain} &middot; {client.timeZone}
                    </p>
                  </div>
                  <Badge tone="caution">Archived</Badge>
                  <ClientArchiveButton client={client} role={membership.role} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
