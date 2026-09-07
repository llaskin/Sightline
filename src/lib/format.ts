import type { Change } from '@/domain/analysis-schema';

/**
 * Display formatting only. Decision arithmetic never passes through here, so
 * rounding can never change a classification.
 */

export const NOT_PROVIDED = 'Not provided';
export const NOT_COMPARABLE = 'Not comparable';

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Half away from zero, rather than JavaScript's half-up which biases negatives. */
function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
  return rounded / factor;
}

function withSign(value: number, rendered: string): string {
  if (value > 0) return `+${rendered}`;
  return rendered;
}

/** Whole-percentage delta for the metric cards, e.g. `+74%`. */
export function formatWholePercent(percent: number | null | undefined): string {
  if (!usable(percent)) return NOT_COMPARABLE;
  const rounded = roundHalfAwayFromZero(percent, 0);
  // `-0` would render as "-0%"; normalise it to a plain zero.
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return withSign(safe, `${safe}%`);
}

/** A ratio rendered as a percentage, one decimal by default and up to three in detail. */
export function formatRate(value: number | null | undefined, decimals = 1): string {
  if (!usable(value)) return NOT_PROVIDED;
  return `${roundHalfAwayFromZero(value * 100, decimals).toFixed(decimals)}%`;
}

/** Percentage-point difference, always two decimals and always labelled `pp`. */
export function formatPercentagePoints(value: number | null | undefined): string {
  if (!usable(value)) return NOT_PROVIDED;
  const rounded = roundHalfAwayFromZero(value, 2);
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return withSign(safe, `${safe.toFixed(2)} pp`);
}

/** A count multiple such as `3x`; one decimal unless exactly integral. */
export function formatMultiple(value: number | null | undefined): string {
  if (!usable(value)) return NOT_PROVIDED;
  const rounded = roundHalfAwayFromZero(value, 1);
  return Number.isInteger(rounded) ? `${rounded}x` : `${rounded.toFixed(1)}x`;
}

export function formatCount(value: number | null | undefined): string {
  if (!usable(value)) return NOT_PROVIDED;
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatSignedInteger(value: number | null | undefined): string {
  if (!usable(value)) return NOT_PROVIDED;
  const safe = Object.is(value, -0) ? 0 : value;
  return withSign(safe, `${safe}`);
}

/** Each change state gets its own words; no state collapses into a number. */
export function formatChange(change: Change): string {
  switch (change.kind) {
    case 'relative':
      return formatWholePercent(change.percent);
    case 'new':
      return 'New activity';
    case 'no_activity':
      return 'No activity';
    case 'unavailable':
      return NOT_COMPARABLE;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats an ISO local date without constructing a Date, avoiding zone shifts. */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

/** Formats a UTC instant for source-freshness display. */
export function formatInstant(iso: string, timeZone = 'UTC'): string {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return NOT_PROVIDED;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}
