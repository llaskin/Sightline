'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Settings as SettingsIcon, Trash2, UserRound } from 'lucide-react';
import { Card, CardHeader, ErrorState, NotProvided } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ErrorSummary, SelectField, TextField } from '@/components/ui/fields';

/**
 * Workspace settings.
 *
 * Everything on this screen is a value the application actually stores. There
 * is no placeholder control for a feature that does not exist, because a switch
 * that changes nothing is a claim the release does not keep.
 */

export type SettingsState = {
  workspaceName: string;
  retentionDays: number | null;
  revision: number;
  role: 'owner' | 'analyst';
  name: string;
  email: string;
};

type RetentionChoice = 'keep' | '90' | '180' | '365' | 'stored';

const RETENTION_LABELS: Record<Exclude<RetentionChoice, 'stored'>, string> = {
  keep: 'Keep everything until I delete it',
  '90': 'Delete after 90 days',
  '180': 'Delete after 180 days',
  '365': 'Delete after 365 days',
};

function toChoice(days: number | null): RetentionChoice {
  if (days === null) return 'keep';
  if (days === 90 || days === 180 || days === 365) return String(days) as RetentionChoice;
  // A value outside the offered set is shown as it is rather than silently
  // redrawn as one of the four choices.
  return 'stored';
}

function describeRetention(days: number | null): string {
  if (days === null) return RETENTION_LABELS.keep;
  if (days === 90 || days === 180 || days === 365) {
    return RETENTION_LABELS[String(days) as '90' | '180' | '365'];
  }
  return `Delete after ${days} days`;
}

export function SettingsForm({ initial }: { initial: SettingsState }) {
  const router = useRouter();
  const isOwner = initial.role === 'owner';

  const [saved, setSaved] = useState(initial);
  const [workspaceName, setWorkspaceName] = useState(initial.workspaceName);
  const [choice, setChoice] = useState<RetentionChoice>(toChoice(initial.retentionDays));

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SettingsState | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const storedChoice = toChoice(saved.retentionDays);

  const options = [
    { value: 'keep', label: RETENTION_LABELS.keep },
    { value: '90', label: RETENTION_LABELS['90'] },
    { value: '180', label: RETENTION_LABELS['180'] },
    { value: '365', label: RETENTION_LABELS['365'] },
  ];
  if (storedChoice === 'stored') {
    options.unshift({
      value: 'stored',
      label: `Leave the stored setting unchanged (${describeRetention(saved.retentionDays)})`,
    });
  }

  /** Reloads the stored settings so a conflict shows what is actually saved. */
  async function loadSaved(): Promise<SettingsState | null> {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) return null;
      const body = await response.json();
      return body.data as SettingsState;
    } catch {
      return null;
    }
  }

  async function save() {
    if (workspaceName.trim().length === 0) {
      setFieldErrors({ workspaceName: ['Give the workspace a name'] });
      setFormError('Nothing was sent. Correct the value and save again.');
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setConflict(null);
    setStatus('saving');

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceName: workspaceName.trim(),
          // 'stored' means the owner did not touch an unrecognised stored
          // value, so the field is omitted and the stored value is kept.
          ...(choice === 'stored'
            ? {}
            : { retentionDays: choice === 'keep' ? null : Number(choice) }),
          expectedRevision: saved.revision,
        }),
      });
      const body = await response.json();

      if (response.status === 409) {
        // The owner's typed name stays on screen; only the revision is stale.
        setStatus('idle');
        const latest = await loadSaved();
        if (latest) {
          setConflict(latest);
          return;
        }
        const latestRevision = body?.error?.latestRevision;
        if (typeof latestRevision === 'number') {
          setConflict({ ...saved, revision: latestRevision });
          return;
        }
        // Retrying with the same stale revision would conflict again forever,
        // so a reload is offered instead of a retry that cannot succeed.
        setFormError(
          'Someone else changed these settings while you were editing, and the saved version could not be read. Your values are still here. Reload the page to continue.',
        );
        return;
      }
      if (!response.ok) {
        const envelope = body as {
          error?: { message?: string; fields?: Record<string, string[]> };
        };
        setFieldErrors(envelope?.error?.fields ?? {});
        setFormError(
          envelope?.error?.message ?? 'These settings could not be saved. Your changes are still here.',
        );
        setStatus('idle');
        return;
      }

      const stored = body.data as SettingsState;
      setSaved(stored);
      setWorkspaceName(stored.workspaceName);
      setChoice(toChoice(stored.retentionDays));
      setStatus('saved');
      // The sidebar renders the workspace name on the server, so it needs a
      // refresh to stop showing the previous one.
      router.refresh();
    } catch {
      setFormError('These settings could not be saved, so the change is still only on this screen.');
      setStatus('idle');
    }
  }

  async function signOut() {
    setSignOutError(null);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        setSignOutError('Signing out did not complete. You are still signed in.');
        return;
      }
      router.push('/login');
      router.refresh();
    } catch {
      setSignOutError('Signing out could not be completed. Check your connection and try again.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl py-6">
      <header className="mb-5">
        <h1 className="mb-1 text-[28px] font-semibold text-ink">Settings</h1>
        <p className="text-[13px] text-ink-muted">Your profile, the workspace name and how long data is kept.</p>
      </header>

      <div className="flex flex-col gap-4">
        <Card className="p-0">
          <CardHeader
            title="Your profile"
            icon={<UserRound size={16} aria-hidden className="text-[#a99bff]" />}
          />
          <dl className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
            <ReadOnlyValue label="Name" value={saved.name} />
            <ReadOnlyValue label="Email" value={saved.email} />
            <ReadOnlyValue label="Role" value={saved.role === 'owner' ? 'Owner' : 'Analyst'} />
            <ReadOnlyValue label="Workspace" value={saved.workspaceName} />
          </dl>
          <p className="px-4 pb-4 text-[11px] leading-relaxed text-ink-faint">
            Accounts and roles are created by an operator. There is no self-service way to change
            your role, your email address or your password from this screen.
          </p>
        </Card>

        <Card className="p-0">
          <CardHeader
            title="Workspace"
            icon={<SettingsIcon size={16} aria-hidden className="text-[#a99bff]" />}
            action={
              <span aria-live="polite" className="text-[11px] text-ink-muted">
                {status === 'saving' ? 'Saving...' : null}
                {status === 'saved' ? 'Saved.' : null}
              </span>
            }
          />
          <div className="flex flex-col gap-3 px-4 pb-4">
            {formError ? <ErrorState title="Not saved" description={formError} /> : null}

            {conflict ? (
              <div role="alert" className="rounded-[10px] border border-caution/50 bg-caution/5 p-3">
                <p className="text-[13px] font-semibold text-caution">
                  Someone else changed these settings while you were editing
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  Nothing has been overwritten and nothing you typed has been thrown away. The saved
                  workspace name is{' '}
                  <span className="text-ink">{conflict.workspaceName || 'Not provided'}</span> and the
                  saved retention setting is{' '}
                  <span className="text-ink">{describeRetention(conflict.retentionDays)}</span>.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      // Adopt the stored revision so the next save can succeed,
                      // while the owner's own values stay in the form.
                      setSaved(conflict);
                      setConflict(null);
                    }}
                  >
                    Keep my values and save again
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSaved(conflict);
                      setWorkspaceName(conflict.workspaceName);
                      setChoice(toChoice(conflict.retentionDays));
                      setConflict(null);
                    }}
                  >
                    Replace mine with the saved values
                  </Button>
                </div>
              </div>
            ) : null}

            <ErrorSummary errors={fieldErrors} />

            {isOwner ? (
              <>
                <TextField
                  label="Workspace display name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  hint="Used in the sidebar and wherever a draft substitutes the agency name token."
                  error={fieldErrors.workspaceName?.join('; ') ?? null}
                />
                <SelectField
                  label="Data retention"
                  value={choice}
                  onChange={(event) => setChoice(event.target.value as RetentionChoice)}
                  options={options}
                  error={fieldErrors.retentionDays?.join('; ') ?? null}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={save} disabled={status === 'saving'}>
                    Save settings
                  </Button>
                </div>
              </>
            ) : (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyValue label="Workspace display name" value={saved.workspaceName} />
                  <ReadOnlyValue label="Data retention" value={describeRetention(saved.retentionDays)} />
                </dl>
                <p className="text-[12px] leading-relaxed text-ink-muted">
                  You are signed in as an analyst, so these values are read-only for you. Only a
                  workspace owner can change the workspace name or the retention setting.
                </p>
              </>
            )}
          </div>
        </Card>

        <RetentionExplanation />

        <NotInThisRelease />

        <Card className="p-0">
          <CardHeader title="Session" />
          <div className="flex flex-col gap-3 px-4 pb-4">
            {signOutError ? <ErrorState title="Still signed in" description={signOutError} /> : null}
            <div className="flex justify-start">
              <Button variant="secondary" onClick={signOut}>
                <LogOut size={14} aria-hidden />
                Sign out
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
      <dd className="text-[14px] text-ink">
        {/* An absent value is named, never rendered as an empty box or a zero. */}
        {value && value.trim().length > 0 ? value : <NotProvided />}
      </dd>
    </div>
  );
}

function RetentionExplanation() {
  return (
    <Card className="p-0">
      <CardHeader
        title="What retention deletes"
        icon={<Trash2 size={16} aria-hidden className="text-[#a99bff]" />}
      />
      <div className="flex flex-col gap-2 px-4 pb-4 text-[13px] leading-relaxed text-ink-muted">
        <p>
          Choosing a retention period sets a cutoff. The maintenance job deletes analyses, and the
          response revisions belonging to them, once they are older than that cutoff. It then deletes
          reports older than the cutoff only if no analysis that was kept still refers to them, so an
          analysis you still have always keeps the report it was built from.
        </p>
        <p>
          Complaints and clients are not removed by retention. They stay until someone deletes them
          explicitly.
        </p>
        <p>
          Exports you have already downloaded live on the machine you downloaded them to, and the
          operator database backups have their own separate retention. Neither is affected by this
          setting, so changing it does not reach a file already downloaded to a laptop, or a backup
          that has already been taken.
        </p>
        <p>
          Deletion happens when the maintenance job next runs, not at the moment you save this
          setting.
        </p>
      </div>
    </Card>
  );
}

/**
 * Named rather than omitted, so nobody has to hunt for a control that was never
 * built. There is deliberately nothing here to switch on.
 */
function NotInThisRelease() {
  const absent = [
    'Google Analytics, Search Console or any other account connection. Reports are imported from files you upload.',
    'Email or in-app notifications.',
    'Billing and subscription management.',
    'Team invitations. Accounts are created by an operator.',
    'Changing your own email address or password from this screen.',
  ];
  return (
    <Card className="p-0">
      <CardHeader title="Not in this release" />
      <div className="px-4 pb-4">
        <p className="mb-2 text-[12px] leading-relaxed text-ink-muted">
          These are listed so it is clear they are absent rather than hidden. There are no controls
          for them anywhere in the application.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-ink-faint">
          {absent.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
