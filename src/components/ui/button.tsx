'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';

/**
 * Buttons are at least 44px tall so they remain comfortable touch targets on a
 * phone, which is a release requirement rather than a preference.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40',
  secondary: 'border border-line-strong bg-surface-raised text-ink hover:border-ink-faint',
  ghost: 'text-ink-muted hover:text-ink',
  danger: 'border border-negative/50 text-negative hover:bg-negative/10',
};

const BASE =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export function Button({
  variant = 'secondary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'secondary',
  className = '',
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BASE} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}
