import type { ReactNode } from 'react';

/**
 * Small presentational primitives shared by every screen. They carry the
 * screenshot's dark palette and spacing, and nothing else: no data access and
 * no formatting decisions.
 */

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag
      className={`rounded-[12px] border border-line bg-surface ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  icon,
  action,
  id,
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
      <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  caution: 'text-caution',
  neutral: 'text-ink-muted',
} as const;

export function Tone({
  tone,
  children,
}: {
  tone: keyof typeof TONE_CLASS;
  children: ReactNode;
}) {
  return <span className={TONE_CLASS[tone]}>{children}</span>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'caution' | 'negative' | 'accent';
}) {
  const classes = {
    neutral: 'border-line text-ink-muted',
    positive: 'border-positive/40 text-positive',
    caution: 'border-caution/40 text-caution',
    negative: 'border-negative/40 text-negative',
    accent: 'border-accent/50 text-[#a99bff]',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${classes}`}
    >
      {children}
    </span>
  );
}

/** An empty state always says what is missing and what to do next. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-[12px] border border-negative/40 bg-negative/5 px-4 py-3">
      <p className="text-[14px] font-semibold text-negative">{title}</p>
      <p className="text-[13px] leading-relaxed text-ink-muted">{description}</p>
      {action}
    </div>
  );
}

/** A value that was not supplied, rendered so it can never read as a zero. */
export function NotProvided({ children = 'Not provided' }: { children?: ReactNode }) {
  return <span className="text-ink-faint italic">{children}</span>;
}

export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
