'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Copy, Pencil, RefreshCw, Check } from 'lucide-react';
import { Card, CardHeader, Badge, ErrorState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

/**
 * The response editor.
 *
 * Two rules govern everything here. A failed save never discards the user's
 * text, and a conflict shows both versions rather than picking a winner.
 */

export type ResponseState = {
  revision: number;
  text: string;
  generatedText: string;
  isEdited: boolean;
  label: string;
};

type Conflict = { latestRevision: number; serverText: string };

export function ResponseEditor({
  analysisId,
  initial,
  readOnly = false,
}: {
  analysisId: string;
  initial: ResponseState;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.text);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'copied' | 'copyFailed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = draft !== saved.text;

  // Warn before a reload or tab close would discard unsaved wording.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function save() {
    setStatus('saving');
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/response`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ editedText: draft, expectedRevision: saved.revision }),
      });
      const body = await response.json();

      if (response.status === 409) {
        // Both versions are kept. Nothing the user typed is thrown away.
        setConflict({
          latestRevision: body.error.latestRevision,
          serverText: body.error.serverText ?? '',
        });
        setStatus('idle');
        return;
      }
      if (!response.ok) {
        setError(body?.error?.message ?? 'The draft could not be saved. Your text is still here.');
        setStatus('idle');
        return;
      }

      setSaved({
        revision: body.data.revision,
        text: body.data.editedText ?? body.data.generatedText,
        generatedText: body.data.generatedText,
        isEdited: body.data.isEdited,
        label: body.data.isEdited ? 'Agency-edited draft' : 'Generated draft',
      });
      setStatus('saved');
      setEditing(false);
    } catch {
      // A network failure must never clear the editor.
      setError('The draft could not be saved, so it is still only on this screen. Try again.');
      setStatus('idle');
    }
  }

  async function regenerate() {
    if (dirty && !window.confirm('Regenerating replaces the text on screen with a new draft. Your unsaved changes will be lost. Continue?')) {
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/response/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: saved.revision }),
      });
      const body = await response.json();
      if (response.status === 409) {
        setConflict({
          latestRevision: body.error.latestRevision,
          serverText: body.error.serverText ?? '',
        });
        setStatus('idle');
        return;
      }
      if (!response.ok) {
        setError(body?.error?.message ?? 'The draft could not be regenerated.');
        setStatus('idle');
        return;
      }
      const next = {
        revision: body.data.revision,
        text: body.data.generatedText,
        generatedText: body.data.generatedText,
        isEdited: false,
        label: 'Generated draft',
      };
      setSaved(next);
      setDraft(next.text);
      setStatus('saved');
    } catch {
      setError('The draft could not be regenerated. Nothing changed.');
      setStatus('idle');
    }
  }

  async function copy() {
    // Copies exactly what is visible in the editor, saved or not.
    try {
      await navigator.clipboard.writeText(draft);
      setStatus('copied');
    } catch {
      // Clipboard permission can be refused. Select the text so the user can
      // copy it by hand rather than being told it simply failed.
      setEditing(true);
      window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 0);
      setStatus('copyFailed');
    }
  }

  return (
    <Card className="p-0">
      <CardHeader
        id="response-heading"
        title="Suggested Response"
        icon={<MessageSquare size={16} aria-hidden className="text-[#a99bff]" />}
        action={<Badge tone={saved.isEdited ? 'caution' : 'neutral'}>{saved.label}</Badge>}
      />

      <div className="px-4 pb-4">
        {error ? (
          <div className="mb-3">
            <ErrorState title="Not saved" description={error} />
          </div>
        ) : null}

        {conflict ? (
          <ConflictPanel
            conflict={conflict}
            localText={draft}
            onKeepMine={() => {
              // Adopt the server's revision so the next save can succeed, while
              // keeping the user's own wording in the editor.
              setSaved((previous) => ({
                ...previous,
                revision: conflict.latestRevision,
                text: conflict.serverText,
              }));
              setConflict(null);
              setEditing(true);
            }}
            onTakeTheirs={() => {
              setDraft(conflict.serverText);
              setSaved((previous) => ({
                ...previous,
                revision: conflict.latestRevision,
                text: conflict.serverText,
              }));
              setConflict(null);
            }}
          />
        ) : null}

        {editing && !readOnly ? (
          <>
            <label htmlFor="response-draft" className="sr-only">
              Response draft
            </label>
            <textarea
              id="response-draft"
              ref={textareaRef}
              value={draft}
              maxLength={10_000}
              onChange={(event) => setDraft(event.target.value)}
              className="h-[320px] w-full rounded-[10px] border border-line-strong bg-canvas p-3 text-[13px] leading-relaxed text-ink focus:border-accent"
            />
            <p className="mt-1 text-[11px] text-ink-faint">
              {draft.length} of 10,000 characters.
              {dirty ? ' Unsaved changes.' : ' No unsaved changes.'}
            </p>
          </>
        ) : (
          <div className="max-h-[420px] overflow-y-auto rounded-[10px] border border-line-strong bg-canvas p-3">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{draft}</p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span aria-live="polite" className="mr-auto text-[11px] text-ink-muted">
            {status === 'saving' ? 'Saving...' : null}
            {status === 'saved' ? 'Saved.' : null}
            {status === 'copied' ? 'Copied to the clipboard.' : null}
            {status === 'copyFailed'
              ? 'Copying was blocked by the browser. The text is selected; press Cmd or Ctrl + C.'
              : null}
          </span>

          {!readOnly ? (
            <Button variant="ghost" onClick={regenerate} disabled={status === 'saving'}>
              <RefreshCw size={14} aria-hidden />
              Regenerate
            </Button>
          ) : null}
          <Button variant="secondary" onClick={copy}>
            {status === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            Copy
          </Button>
          {readOnly ? null : editing ? (
            <Button variant="primary" onClick={save} disabled={status === 'saving' || !dirty}>
              Save draft
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden />
              Edit
            </Button>
          )}
        </div>

        {readOnly ? (
          <p className="mt-2 text-[11px] text-ink-faint">
            This is a demo. Edits here are not saved anywhere.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function ConflictPanel({
  conflict,
  localText,
  onKeepMine,
  onTakeTheirs,
}: {
  conflict: Conflict;
  localText: string;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-3 rounded-[10px] border border-caution/50 bg-caution/5 p-3"
    >
      <p className="text-[13px] font-semibold text-caution">
        Someone else saved this draft while you were editing
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
        Nothing has been overwritten. Both versions are below; choose which to keep, or copy the
        parts you need from each.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-medium text-ink">Your version, still unsaved</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
            {localText}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-ink">
            Saved version (revision {conflict.latestRevision})
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
            {conflict.serverText}
          </pre>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onKeepMine}>
          Keep editing mine
        </Button>
        <Button variant="ghost" onClick={onTakeTheirs}>
          Replace mine with the saved version
        </Button>
      </div>
    </div>
  );
}
