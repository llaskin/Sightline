'use client';

/*
 * Renders SponsorBanner. The attribution it displays is required by additional
 * terms under AGPL-3.0 section 7; see ADDITIONAL-TERMS.md.
 */

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Menu, X, LogOut } from 'lucide-react';
import { BrandMark, NavList } from './navigation';
import { Button } from './ui/button';
import { SponsorBanner } from '@/components/sponsor-banner';

/**
 * Responsive application shell.
 *
 *   >= 1280px  full 288px sidebar and two content columns
 *   1024-1279  76px icon rail with labels kept for assistive technology
 *   < 1024     stacked content with a menu drawer
 */

export function AppShell({
  user,
  children,
}: {
  user: { name: string; role: string; workspaceName: string };
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      {/* Full sidebar and icon rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col border-r border-line bg-sidebar px-3 py-4 lg:flex xl:w-[288px] xl:px-4">
        <Link
          href="/dashboard"
          className="mb-5 flex items-center gap-3 rounded-[10px] px-1 py-1 xl:px-2"
        >
          <BrandMark />
          <span className="hidden text-[18px] font-semibold leading-tight text-ink xl:block">
            Sightline
          </span>
          <span className="sr-only xl:hidden">Sightline</span>
        </Link>

        <div className="hidden xl:block">
          <NavList />
        </div>
        <div className="xl:hidden">
          <NavList collapsed />
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <EvidencePanel />
          <UserPanel user={user} />
        </div>
      </aside>

      {/* Mobile header and drawer */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="text-[15px] font-semibold text-ink">Sightline</span>
        </Link>
        <Button
          variant="secondary"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
        </Button>
      </header>

      {menuOpen ? (
        <div
          id="mobile-menu"
          className="sticky top-[61px] z-20 border-b border-line bg-sidebar px-4 py-3 lg:hidden"
        >
          <NavList onNavigate={() => setMenuOpen(false)} />
          <div className="mt-3">
            <UserPanel user={user} />
          </div>
        </div>
      ) : null}

      <main id="main" className="lg:pl-[76px] xl:pl-[288px]">
        <div className="mx-auto w-full max-w-[1420px] px-4 py-5 sm:px-6 lg:px-6 xl:px-7">
          {children}
        </div>
      </main>

      {/* Outside <main> on purpose: a <footer> nested inside main, article,
          aside, nav or section is not a contentinfo landmark, so it would not
          be announced as the page footer. The offset matches main's, so it
          clears the fixed sidebar at every width. */}
      <div className="lg:pl-[76px] xl:pl-[288px]">
        <SponsorBanner />
      </div>
    </div>
  );
}

/** A simple drawn panel. Deliberately not a person, and not a portrait. */
function EvidencePanel() {
  return (
    <div className="hidden rounded-[12px] border border-line bg-accent-soft p-4 xl:block">
      <p className="text-[13px] leading-relaxed text-ink">
        Evidence first.
        <br />
        Conclusions second.
      </p>
      <svg
        viewBox="0 0 120 48"
        className="mt-3 h-12 w-full"
        role="img"
        aria-label="A magnifier over a rising line chart"
      >
        <polyline
          points="4,40 26,32 48,34 70,20 92,24 114,8"
          fill="none"
          stroke="var(--color-chart-b)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="70" cy="20" r="13" fill="none" stroke="#a99bff" strokeWidth="2.5" />
        <line x1="79" y1="29" x2="92" y2="42" stroke="#a99bff" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function UserPanel({ user }: { user: { name: string; role: string; workspaceName: string } }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-2 py-2 xl:px-3">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden min-w-0 flex-1 xl:block">
        <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
        <span className="block truncate text-[11px] capitalize text-ink-muted">
          {user.role} &middot; {user.workspaceName}
        </span>
      </span>
      <form action="/api/auth/sign-out" method="post" className="hidden xl:block">
        <button
          type="submit"
          aria-label="Sign out"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-muted hover:text-ink"
        >
          <LogOut size={15} aria-hidden />
        </button>
      </form>
    </div>
  );
}
