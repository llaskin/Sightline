'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField, TextAreaField, ErrorSummary } from '@/components/ui/fields';
import { Card, CardHeader, ErrorState } from '@/components/ui/primitives';

/**
 * Client creation and editing.
 *
 * Every save carries the revision the form was loaded with, so a second editor
 * gets a conflict message instead of quietly overwriting the first. A failed
 * save leaves the typed values in place; nothing is cleared on error.
 */

export type ClientDefinitions = {
  propertyLabel: string;
  leadDefinition: string;
  leadEventName: string | null;
  defaultWindowDays: number;
};

export type ClientView = {
  id: string;
  name: string;
  domain: string;
  timeZone: string;
  definitions: ClientDefinitions;
  archivedAt: string | null;
  revision: number;
};

type ApiFailure = { message: string; fields: Record<string, string[]> };

/** Turns the shared error envelope into something a form can render. */
async function readFailure(response: Response): Promise<ApiFailure> {
  let code = 'INTERNAL';
  let message = 'That could not be saved. Your values are still here.';
  let fields: Record<string, string[]> = {};
  try {
    const body = await response.json();
    code = body?.error?.code ?? code;
    message = body?.error?.message ?? message;
    fields = body?.error?.fields ?? {};
  } catch {
    // A response with no JSON body keeps the generic message above.
  }
  if (code === 'FORBIDDEN') {
    message = 'Your role does not allow this. Ask a workspace owner to do it.';
  }
  return { message, fields };
}

const BLANK: ClientView = {
  id: '',
  name: '',
  domain: '',
  // A guessed zone is better than a blank one, and the field stays editable.
  timeZone: 'America/New_York',
  definitions: {
    propertyLabel: '',
    leadDefinition: '',
    leadEventName: null,
    defaultWindowDays: 28,
  },
  archivedAt: null,
  revision: 1,
};

function ClientForm({
  mode,
  client,
  onFinished,
}: {
  mode: 'create' | 'edit';
  client?: ClientView;
  onFinished?: () => void;
}) {
  const router = useRouter();
  const initial = client ?? BLANK;
  const [name, setName] = useState(initial.name);
  const [domain, setDomain] = useState(initial.domain);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [propertyLabel, setPropertyLabel] = useState(initial.definitions.propertyLabel);
  const [leadDefinition, setLeadDefinition] = useState(initial.definitions.leadDefinition);
  const [leadEventName, setLeadEventName] = useState(initial.definitions.leadEventName ?? '');
  const [windowDays, setWindowDays] = useState(String(initial.definitions.defaultWindowDays));
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFailure(null);

    const definitions = {
      propertyLabel,
      leadDefinition,
      leadEventName: leadEventName.trim() === '' ? null : leadEventName.trim(),
      // A blank window falls back to the documented default rather than zero.
      defaultWindowDays: windowDays.trim() === '' ? 28 : Number(windowDays),
    };
    const body =
      mode === 'create'
        ? { name, domain, timeZone, definitions }
        : { name, domain, timeZone, definitions, expectedRevision: initial.revision };

    try {
      const response = await fetch(
        mode === 'create' ? '/api/clients' : `/api/clients/${initial.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        setFailure(await readFailure(response));
        setPending(false);
        return;
      }
      const saved = await response.json();
      onFinished?.();
      router.refresh();
      if (mode === 'create') router.push(`/clients/${saved.data.id}`);
      setPending(false);
    } catch {
      setFailure({
        message: 'The save could not be sent. Check your connection and try again.',
        fields: {},
      });
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4">
      {failure ? (
        <ErrorState
          title={mode === 'create' ? 'Could not create this client' : 'Could not save this client'}
          description={failure.message}
        />
      ) : null}
      {failure ? <ErrorSummary errors={failure.fields} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Client name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Domain"
          required
          hint="A bare host such as example.com. Nothing is fetched from it."
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
        />
        <TextField
          label="Time zone"
          required
          hint="An IANA zone such as America/New_York. Reporting windows are read in this zone."
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
        />
        <TextField
          label="Default reporting window (days)"
          type="number"
          min={7}
          max={93}
          value={windowDays}
          onChange={(event) => setWindowDays(event.target.value)}
        />
      </div>

      <TextField
        label="Property label"
        hint="How the analytics property is named in the client's account."
        value={propertyLabel}
        onChange={(event) => setPropertyLabel(event.target.value)}
      />
      <TextAreaField
        label="Lead definition"
        hint="What counts as a lead for this client, in one sentence. Imported reports repeat this wording."
        value={leadDefinition}
        onChange={(event) => setLeadDefinition(event.target.value)}
      />
      <TextField
        label="Lead event name"
        hint="Optional. The event key in the analytics property, for example generate_lead."
        value={leadEventName}
        onChange={(event) => setLeadEventName(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving...' : mode === 'create' ? 'Create client' : 'Save changes'}
        </Button>
        {onFinished ? (
          <Button type="button" onClick={onFinished} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The create form on the clients list, opened by the button or by `?new=1`. */
export function CreateClientPanel({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden />
        Add a client
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader title="New client" />
      <ClientForm mode="create" onFinished={() => setOpen(false)} />
    </Card>
  );
}

/** The always-visible edit form on a client's own page. */
export function EditClientPanel({ client }: { client: ClientView }) {
  return (
    <Card>
      <CardHeader title="Details and definitions" />
      <ClientForm mode="edit" client={client} />
    </Card>
  );
}

/**
 * Archive and restore.
 *
 * The API allows this for an owner only. An analyst is told that plainly rather
 * than being shown a generic failure, and the button is disabled up front.
 */
export function ClientArchiveButton({
  client,
  role,
}: {
  client: ClientView;
  role: 'owner' | 'analyst';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = client.archivedAt !== null;

  if (role !== 'owner') {
    return (
      <p className="text-[12px] text-ink-faint">
        {archived ? 'Restoring' : 'Archiving'} a client is limited to a workspace owner.
      </p>
    );
  }

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: !archived, expectedRevision: client.revision }),
      });
      if (!response.ok) {
        const failure = await readFailure(response);
        setError(failure.message);
        setPending(false);
        return;
      }
      router.refresh();
      setPending(false);
    } catch {
      setError('That could not be sent. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button onClick={toggle} disabled={pending}>
        {archived ? <ArchiveRestore size={15} aria-hidden /> : <Archive size={15} aria-hidden />}
        {pending ? 'Working...' : archived ? 'Restore' : 'Archive'}
      </Button>
      {error ? <p className="text-[11px] text-negative">{error}</p> : null}
    </div>
  );
}

/**
 * Permanent deletion.
 *
 * The API has been able to do this since the data-lifecycle work; this panel is
 * the only way an owner can reach it. The typed name must match exactly, and a
 * near miss is refused rather than interpreted generously, because a
 * destructive confirmation that guesses at intent is not a confirmation. An
 * analyst is told the rule plainly instead of being handed a control the server
 * would refuse.
 */
export function DeleteClientPanel({
  client,
  role,
}: {
  client: ClientView;
  role: 'owner' | 'analyst';
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);

  if (role !== 'owner') {
    return (
      <Card>
        <CardHeader title="Removing a client" />
        <p className="px-4 pb-4 text-[13px] leading-relaxed text-ink-muted">
          Archiving is reversible and removes nothing, so please do not read it as a delete.
          Permanent deletion is limited to a workspace owner.
        </p>
      </Card>
    );
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmName: typed }),
      });
      if (!response.ok) {
        setFailure(await readFailure(response));
        setPending(false);
        return;
      }
      // The page that was just deleted cannot be re-rendered, so the reader is
      // sent to the list rather than left on a 404. `pending` stays true so the
      // button cannot be pressed twice during the navigation.
      router.push('/clients');
      router.refresh();
    } catch {
      setFailure({
        message: 'That could not be sent. Check your connection and try again.',
        fields: {},
      });
      setPending(false);
    }
  }

  return (
    <Card className="border-negative/40">
      <CardHeader title="Delete this client permanently" />
      <form onSubmit={remove} className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-muted">
          <p>
            This removes {client.name} together with its complaints, import drafts, committed
            reports, analyses and every saved response revision, in one transaction. It cannot be
            undone. Archiving is the reversible option and removes nothing.
          </p>
          <p className="text-ink-faint">
            Two things survive by design: an audit record holding only an identifier and a count,
            with no name, domain or content; and any export already downloaded, which this
            application cannot reach. Database backups keep their own separate retention.
          </p>
        </div>

        {failure ? (
          <ErrorState title="Nothing was deleted" description={failure.message} />
        ) : null}
        {failure ? <ErrorSummary errors={failure.fields} /> : null}

        <TextField
          label="Type the client name to confirm"
          hint={`Type ${client.name} exactly, including capitals.`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />

        <div>
          <Button type="submit" variant="danger" disabled={pending || typed.trim() === ''}>
            <Trash2 size={15} aria-hidden />
            {pending ? 'Deleting...' : 'Delete permanently'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
