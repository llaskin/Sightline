'use client';

import { useMemo, useState } from 'react';
import { FileText, Pencil, Plus, RotateCcw } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, ErrorState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ErrorSummary, TextAreaField, TextField } from '@/components/ui/fields';
import {
  ALLOWED_TOKENS,
  DEFAULT_TEMPLATE_BODY,
  MAX_TEMPLATE_LENGTH,
  validateTemplate,
  type AllowedToken,
} from '@/domain/render-response';

/**
 * Workspace response templates.
 *
 * Two rules govern every write here. A failed save never discards what the
 * owner typed, and a conflict shows both versions instead of picking a winner.
 */

export type TemplateView = {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
  revision: number;
  updatedAt: string;
};

const TOKEN_DESCRIPTIONS: Record<AllowedToken, string> = {
  client_name: 'The client name recorded on the client record.',
  agency_name: 'Your workspace display name, taken from Settings.',
  current_period: 'The dates of the period being examined.',
  baseline_period: 'The dates of the earlier period it is compared against.',
  complaint_summary: "The complaint in the client's own words, quoted.",
  evidence_summary: 'The figures the analysis found, followed by its headline.',
  caveats: 'The outcome assessment and what the evidence does not establish.',
  next_steps: 'The suggested next checks and the function to involve in each.',
  sender_name: 'The name of the person signed in when the draft is generated.',
};

/**
 * Preview values only. They are visibly fictional so a preview can never be
 * mistaken for a draft built from a real client report.
 */
const SAMPLE_VALUES: Record<AllowedToken, string> = {
  client_name: 'Sample Client Ltd',
  agency_name: 'Sample Agency',
  sender_name: 'Sample Sender',
  current_period: '1 to 31 August 2026 (sample)',
  baseline_period: '1 to 31 July 2026 (sample)',
  complaint_summary: '"We are not getting the calls we used to get." (sample text)',
  evidence_summary:
    'Here is what the report shows for the sample period, for organic search:\n' +
    '- Organic sessions: 1,000 to 1,400 (+40%). (sample figure)\n' +
    '- Tracked lead-session rate: 3.0% to 2.1% (-30%). A lead session is a session containing the lead action, not a lead that reached you. (sample figure)\n' +
    '\n' +
    'Sessions rose while the tracked lead-session rate fell. (sample headline)',
  caveats:
    'The records show your account of what happened is borne out by the evidence we have. (sample assessment)\n' +
    '\n' +
    'What this does not establish:\n' +
    '- We have not reconciled these tracked actions against your inbox or CRM, so we cannot yet say how many leads actually reached you.\n' +
    '- More sessions on their own do not establish that the traffic is more relevant. (sample caveat)',
  next_steps:
    'Suggested next checks:\n' +
    '- Confirm the contact form still submits on mobile. (web development) (sample check)',
};

/** The same shape renderResponse uses, so the preview matches what it produces. */
const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Mirrors renderResponse: substitute once, then append any mandatory paragraph
 * whose token is absent. The `includes` checks are exact, matching the drafting
 * code, so a token written as `{{ caveats }}` both substitutes and appends here
 * exactly as it would in a real draft.
 */
function buildPreview(body: string): string {
  const substituted = body.replace(TOKEN_PATTERN, (match, token: string) =>
    ALLOWED_TOKENS.includes(token as AllowedToken) ? SAMPLE_VALUES[token as AllowedToken] : match,
  );
  const appended: string[] = [];
  if (!body.includes('{{evidence_summary}}')) appended.push(SAMPLE_VALUES.evidence_summary);
  if (!body.includes('{{caveats}}')) appended.push(SAMPLE_VALUES.caveats);
  if (!body.includes('{{next_steps}}')) appended.push(SAMPLE_VALUES.next_steps);
  return [substituted.trimEnd(), '', ...appended]
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function formatUpdated(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Not provided';
  // A fixed format, so the server and the browser never render it differently.
  return parsed.toISOString().slice(0, 10);
}

type Mode = 'view' | 'edit' | 'create';

type Conflict = { latestRevision: number; saved: TemplateView | null };

export function TemplateEditor({
  initialTemplates,
  role,
}: {
  initialTemplates: TemplateView[];
  role: 'owner' | 'analyst';
}) {
  const isOwner = role === 'owner';
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState<string | null>(initialTemplates[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>('view');

  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [baseRevision, setBaseRevision] = useState(1);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const selected = templates.find((template) => template.id === selectedId) ?? null;
  const liveValidation = useMemo(() => validateTemplate(draftBody), [draftBody]);
  const editing = mode !== 'view';

  function startEdit(template: TemplateView) {
    setDraftName(template.name);
    setDraftBody(template.body);
    setBaseRevision(template.revision);
    setMode('edit');
    clearMessages();
  }

  function startCreate() {
    setDraftName('');
    // The bundled text is a valid starting point, so a new template is never
    // an empty box the owner has to guess the token syntax for.
    setDraftBody(DEFAULT_TEMPLATE_BODY);
    setBaseRevision(1);
    setMode('create');
    clearMessages();
  }

  function clearMessages() {
    setFieldErrors({});
    setFormError(null);
    setConflict(null);
    setStatus('idle');
  }

  function applyErrorBody(body: unknown, fallback: string) {
    const envelope = body as { error?: { message?: string; fields?: Record<string, string[]> } };
    setFieldErrors(envelope?.error?.fields ?? {});
    setFormError(envelope?.error?.message ?? fallback);
  }

  /**
   * Handles a 409. Without the stored revision a retry would send the same
   * stale number and conflict again forever, so that case asks for a reload
   * instead of offering a retry that cannot succeed.
   */
  async function handleConflict(id: string, latestRevision: unknown): Promise<void> {
    if (typeof latestRevision !== 'number') {
      setFormError(
        'Someone else changed this template while you were editing, and the new revision could not be read. Your text is still here. Reload the page to continue.',
      );
      return;
    }
    await loadConflict(id, latestRevision);
  }

  /** Loads the stored version so a conflict can show both texts, never one. */
  async function loadConflict(id: string, latestRevision: number) {
    try {
      const response = await fetch(`/api/templates/${id}`);
      if (!response.ok) {
        setConflict({ latestRevision, saved: null });
        return;
      }
      const body = await response.json();
      setConflict({ latestRevision, saved: body.data as TemplateView });
    } catch {
      setConflict({ latestRevision, saved: null });
    }
  }

  function localCheck(): boolean {
    const errors: Record<string, string[]> = {};
    if (draftName.trim().length === 0) errors.name = ['Give the template a name'];
    const validation = validateTemplate(draftBody);
    if (!validation.valid) errors.body = validation.errors.map((error) => error.message);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError('Nothing was sent. Correct the template and save again.');
      return false;
    }
    setFormError(null);
    return true;
  }

  async function save() {
    if (!localCheck()) return;
    setStatus('saving');
    setConflict(null);
    try {
      const creating = mode === 'create';
      const response = await fetch(
        creating ? '/api/templates' : `/api/templates/${selectedId}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            creating
              ? { name: draftName.trim(), body: draftBody }
              : { name: draftName.trim(), body: draftBody, expectedRevision: baseRevision },
          ),
        },
      );
      const body = await response.json();

      if (response.status === 409 && selectedId) {
        // The owner's typed text stays on screen; only the base revision is stale.
        setStatus('idle');
        await handleConflict(selectedId, body?.error?.latestRevision);
        return;
      }
      if (!response.ok) {
        applyErrorBody(body, 'The template could not be saved. Your text is still here.');
        setStatus('idle');
        return;
      }

      const stored = body.data as TemplateView;
      setTemplates((previous) =>
        creating
          ? [...previous, stored]
          : previous.map((template) => (template.id === stored.id ? stored : template)),
      );
      setSelectedId(stored.id);
      setBaseRevision(stored.revision);
      setMode('view');
      setFieldErrors({});
      setFormError(null);
      setStatus('saved');
    } catch {
      setFormError('The template could not be saved, so it is still only on this screen. Try again.');
      setStatus('idle');
    }
  }

  async function resetToDefault() {
    if (!selectedId) return;
    // Reset writes to the stored template, so it is confirmed against the
    // bundled text rather than against the unsaved draft. Wording that was
    // already saved would otherwise be replaced without a prompt.
    if (
      draftBody !== DEFAULT_TEMPLATE_BODY &&
      !window.confirm(
        'Resetting replaces the stored wording of this template with the bundled default text. Any wording you have added, saved or not, will be replaced. Continue?',
      )
    ) {
      return;
    }
    setStatus('saving');
    setConflict(null);
    try {
      const response = await fetch(`/api/templates/${selectedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reset: true, expectedRevision: baseRevision }),
      });
      const body = await response.json();

      if (response.status === 409) {
        setStatus('idle');
        await handleConflict(selectedId, body?.error?.latestRevision);
        return;
      }
      if (!response.ok) {
        applyErrorBody(body, 'The template could not be reset. Your text is still here.');
        setStatus('idle');
        return;
      }

      const stored = body.data as TemplateView;
      setTemplates((previous) =>
        previous.map((template) => (template.id === stored.id ? stored : template)),
      );
      setDraftName(stored.name);
      setDraftBody(stored.body);
      setBaseRevision(stored.revision);
      setStatus('saved');
    } catch {
      setFormError('The template could not be reset. Nothing changed.');
      setStatus('idle');
    }
  }

  const previewSource = editing ? draftBody : (selected?.body ?? '');

  return (
    <div className="py-6">
      <header className="mb-5">
        <h1 className="mb-1 text-[28px] font-semibold text-ink">Templates</h1>
        <p className="text-[13px] text-ink-muted">
          The wording used when a draft response is generated for a client.
        </p>
      </header>

      <GuaranteeNotice />

      {!isOwner ? (
        <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
          You are signed in as an analyst, so these templates are read-only for you. Only a
          workspace owner can create, edit or reset them.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card className="p-0">
            <CardHeader
              title="Workspace templates"
              icon={<FileText size={16} aria-hidden className="text-[#a99bff]" />}
              action={
                isOwner ? (
                  <Button variant="secondary" onClick={startCreate}>
                    <Plus size={14} aria-hidden />
                    New
                  </Button>
                ) : null
              }
            />
            {templates.length === 0 ? (
              <EmptyState
                title="No templates yet"
                description={
                  isOwner
                    ? 'Create one to control the wording around the generated evidence.'
                    : 'Ask a workspace owner to create one. A draft can still be generated from the bundled default text.'
                }
                action={
                  isOwner ? (
                    <Button variant="primary" onClick={startCreate}>
                      Create a template
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="flex flex-col gap-1 px-2 pb-3">
                {templates.map((template) => {
                  const active = template.id === selectedId && mode !== 'create';
                  return (
                    <li key={template.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(template.id);
                          setMode('view');
                          clearMessages();
                        }}
                        aria-current={active ? 'true' : undefined}
                        className={`flex min-h-[44px] w-full flex-col items-start gap-1 rounded-[10px] px-3 py-2 text-left transition-colors ${
                          active ? 'bg-surface-raised' : 'hover:bg-surface-raised'
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-ink">{template.name}</span>
                          {template.isDefault ? <Badge tone="accent">Workspace default</Badge> : null}
                        </span>
                        <span className="text-[11px] text-ink-faint">
                          Revision {template.revision}, last changed {formatUpdated(template.updatedAt)}
                          {template.body === DEFAULT_TEMPLATE_BODY
                            ? '. Matches the bundled default text.'
                            : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {templates.length > 0 ? (
              <p className="px-4 pb-4 text-[11px] leading-relaxed text-ink-faint">
                The workspace default is the template an analysis uses when no other one is chosen.
                A template also says whether its wording still matches the text this application
                ships with.
              </p>
            ) : null}
          </Card>

          <TokenReference />
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-0">
            <CardHeader
              title={
                mode === 'create'
                  ? 'New template'
                  : (selected?.name ?? 'No template selected')
              }
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
                <ConflictPanel
                  conflict={conflict}
                  localBody={draftBody}
                  onKeepMine={() => {
                    // Adopt the stored revision so the next save can succeed,
                    // while the owner's own wording stays in the editor.
                    setBaseRevision(conflict.latestRevision);
                    if (conflict.saved) {
                      setTemplates((previous) =>
                        previous.map((template) =>
                          template.id === conflict.saved?.id ? conflict.saved : template,
                        ),
                      );
                    }
                    setConflict(null);
                    setMode('edit');
                  }}
                  onTakeTheirs={
                    conflict.saved
                      ? () => {
                          const saved = conflict.saved as TemplateView;
                          setDraftName(saved.name);
                          setDraftBody(saved.body);
                          setBaseRevision(saved.revision);
                          setTemplates((previous) =>
                            previous.map((template) => (template.id === saved.id ? saved : template)),
                          );
                          setConflict(null);
                        }
                      : undefined
                  }
                />
              ) : null}

              <ErrorSummary errors={fieldErrors} />

              {editing && isOwner ? (
                <>
                  <TextField
                    label="Template name"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    error={fieldErrors.name?.join('; ') ?? null}
                  />
                  <TextAreaField
                    label="Template body"
                    rows={18}
                    value={draftBody}
                    onChange={(event) => setDraftBody(event.target.value)}
                    hint="Plain text. A token is written as two braces around its name, for example {{client_name}}."
                    error={fieldErrors.body?.join('; ') ?? null}
                  />
                  <p
                    className={`text-[11px] ${
                      draftBody.length > MAX_TEMPLATE_LENGTH ? 'text-negative' : 'text-ink-faint'
                    }`}
                  >
                    {draftBody.length} of {MAX_TEMPLATE_LENGTH.toLocaleString('en-GB')} characters.
                  </p>

                  {liveValidation.valid ? (
                    <p className="text-[11px] text-positive">Every token in this template is supported.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-[11px] text-caution">
                      {liveValidation.errors.map((error) => (
                        <li key={`${error.code}-${error.message}`}>{error.message}</li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setMode('view');
                        clearMessages();
                      }}
                    >
                      Cancel
                    </Button>
                    {mode === 'edit' ? (
                      <Button variant="secondary" onClick={resetToDefault} disabled={status === 'saving'}>
                        <RotateCcw size={14} aria-hidden />
                        Reset to the bundled default
                      </Button>
                    ) : null}
                    <Button variant="primary" onClick={save} disabled={status === 'saving'}>
                      {mode === 'create' ? 'Create template' : 'Save template'}
                    </Button>
                  </div>
                </>
              ) : selected ? (
                <>
                  <div className="max-h-[460px] overflow-y-auto rounded-[10px] border border-line-strong bg-canvas p-3">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                      {selected.body}
                    </p>
                  </div>
                  <p className="text-[11px] text-ink-faint">
                    {selected.body.length} of {MAX_TEMPLATE_LENGTH.toLocaleString('en-GB')} characters.
                  </p>
                  {isOwner ? (
                    <div className="flex justify-end">
                      <Button variant="primary" onClick={() => startEdit(selected)}>
                        <Pencil size={14} aria-hidden />
                        Edit
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[12px] text-ink-muted">
                      Read-only. Only a workspace owner can change this template.
                    </p>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-[13px] text-ink-muted">
                  Select a template to read it.
                </p>
              )}
            </div>
          </Card>

          {previewSource ? <PreviewPanel body={previewSource} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The guarantee is stated at the top because it is the one thing an owner needs
 * to know before editing: the limitations cannot be edited out of a draft.
 */
function GuaranteeNotice() {
  return (
    <div className="mb-4 rounded-[12px] border border-accent/50 bg-accent-soft p-4">
      <p className="text-[14px] font-semibold text-ink">
        Editing a template cannot remove the evidence or the limitations
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        The evidence paragraph, the caveats and the suggested next checks are built by the analysis,
        not by the template. If you delete{' '}
        <code className="text-ink">{'{{evidence_summary}}'}</code>,{' '}
        <code className="text-ink">{'{{caveats}}'}</code> or{' '}
        <code className="text-ink">{'{{next_steps}}'}</code>, the drafting code appends that
        paragraph to the end of the generated draft instead of leaving it out. A template controls
        where those paragraphs appear and what is written around them. It cannot hide them from a
        client.
      </p>
    </div>
  );
}

function TokenReference() {
  return (
    <Card className="p-0">
      <CardHeader title="Supported tokens" />
      <dl className="flex flex-col gap-2 px-4 pb-4">
        {ALLOWED_TOKENS.map((token) => (
          <div key={token}>
            <dt className="text-[12px] font-medium text-ink">
              <code>{`{{${token}}}`}</code>
            </dt>
            <dd className="text-[11px] leading-relaxed text-ink-muted">
              {TOKEN_DESCRIPTIONS[token]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="px-4 pb-4 text-[11px] leading-relaxed text-ink-faint">
        Any other token is rejected when you save, and the unsupported name is reported back to you.
      </p>
    </Card>
  );
}

function PreviewPanel({ body }: { body: string }) {
  const preview = useMemo(() => buildPreview(body), [body]);
  return (
    <Card className="p-0">
      <CardHeader title="Preview with sample values" />
      <div className="px-4 pb-4">
        <p className="mb-2 text-[12px] leading-relaxed text-caution">
          This is a preview built from invented sample figures. It is not a client draft and none of
          these numbers come from a real report.
        </p>
        <div className="max-h-[420px] overflow-y-auto rounded-[10px] border border-line-strong bg-canvas p-3">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">{preview}</p>
        </div>
      </div>
    </Card>
  );
}

function ConflictPanel({
  conflict,
  localBody,
  onKeepMine,
  onTakeTheirs,
}: {
  conflict: Conflict;
  localBody: string;
  onKeepMine: () => void;
  onTakeTheirs?: () => void;
}) {
  return (
    <div role="alert" className="rounded-[10px] border border-caution/50 bg-caution/5 p-3">
      <p className="text-[13px] font-semibold text-caution">
        Someone else changed this template while you were editing
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
        Nothing has been overwritten and nothing you typed has been thrown away. Choose which
        version to keep, or copy the parts you need from each.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-medium text-ink">Your version, still unsaved</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
            {localBody}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-ink">
            Saved version (revision {conflict.latestRevision})
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
            {conflict.saved
              ? conflict.saved.body
              : 'The saved version could not be loaded. Reload the page to read it.'}
          </pre>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onKeepMine}>
          Keep editing mine
        </Button>
        {onTakeTheirs ? (
          <Button variant="ghost" onClick={onTakeTheirs}>
            Replace mine with the saved version
          </Button>
        ) : null}
      </div>
    </div>
  );
}
