'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  UploadCloud,
  MessageSquare,
  History,
  Users,
  FileText,
  Settings,
} from 'lucide-react';

/**
 * Sidebar navigation. Every destination here is implemented; nothing is listed
 * that does not work, because a dead navigation item is a promise the release
 * does not keep.
 */

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reports/new', label: 'Upload Report', icon: UploadCloud },
  { href: '/complaints', label: 'Complaints', icon: MessageSquare },
  { href: '/history', label: 'Analysis History', icon: History },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/templates', label: 'Templates', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/** A new mark, not a reproduction of the screenshot's icon. */
/**
 * The Sightline mark: scattered evidence resolving into one straight line.
 *
 * Kept in sync with src/app/icon.svg and public/brand/sightline-master.svg. It
 * is drawn inline rather than loaded as an image so it stays crisp at every
 * size and needs no network request in the shell.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] border border-line-strong bg-surface-raised"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size * 0.72}
        height={size * 0.72}
        focusable="false"
        aria-hidden
      >
        <g fill="#a99bff">
          <circle cx="15" cy="32" r="5" />
          <circle cx="15" cy="68" r="5" />
          <circle cx="28" cy="42" r="4.5" />
          <circle cx="28" cy="58" r="4.5" />
        </g>
        <circle cx="40" cy="50" r="4" fill="#5940e8" />
        <rect x="47" y="45" width="43" height="10" rx="5" fill="#5940e8" />
      </svg>
    </span>
  );
}

export function NavList({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href ||
          (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)) ||
          (item.href === '/reports/new' && pathname.startsWith('/reports'));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={`flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 text-[14px] transition-colors ${
              active
                ? 'bg-accent text-white'
                : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
            } ${collapsed ? 'justify-center px-0' : ''}`}
          >
            <Icon size={18} aria-hidden strokeWidth={2} />
            {/* At the icon rail the label stays available to assistive tech. */}
            <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
