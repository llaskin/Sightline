'use client';

import { useId, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';

/**
 * Every field is labelled, and an error is tied to its input with
 * aria-describedby so a screen reader announces the reason rather than only a
 * red border.
 */

const CONTROL =
  'w-full min-h-[44px] rounded-[10px] border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent';

function Wrapper({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-muted">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-[11px] leading-relaxed text-ink-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-[11px] text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Wrapper id={id} label={label} hint={hint} error={error}>
      <input
        {...rest}
        id={id}
        className={CONTROL}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null]
          .filter(Boolean)
          .join(' ') || undefined}
      />
    </Wrapper>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string | null;
}) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Wrapper id={id} label={label} hint={hint} error={error}>
      <textarea
        {...rest}
        id={id}
        className={`${CONTROL} min-h-[120px] leading-relaxed`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null]
          .filter(Boolean)
          .join(' ') || undefined}
      />
    </Wrapper>
  );
}

export function SelectField({
  label,
  hint,
  error,
  options,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string | null;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Wrapper id={id} label={label} hint={hint} error={error}>
      <select
        {...rest}
        id={id}
        className={CONTROL}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null]
          .filter(Boolean)
          .join(' ') || undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

/** A summary of every field error, focusable so a submit can jump to it. */
export function ErrorSummary({ errors }: { errors: Record<string, string[]> }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      id="error-summary"
      className="rounded-[10px] border border-negative/40 bg-negative/5 p-3"
    >
      <p className="text-[13px] font-semibold text-negative">
        {entries.length === 1 ? 'One field needs correcting' : `${entries.length} fields need correcting`}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-ink-muted">
        {entries.map(([field, messages]) => (
          <li key={field}>
            <span className="text-ink">{field}</span>: {messages.join('; ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
