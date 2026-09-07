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
  Search,
  LineChart,
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
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center rounded-[10px] border border-line-strong bg-surface-raised"
      style={{ width: size, height: size }}
    >
      <Search size={size * 0.55} className="text-[#a99bff]" strokeWidth={2.2} />
      <LineChart
        size={size * 0.3}
        className="absolute bottom-1 right-1 text-positive"
        strokeWidth={2.6}
      />
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
