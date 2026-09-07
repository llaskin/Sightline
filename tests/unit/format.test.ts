import { describe, expect, it } from 'vitest';
import {
  formatWholePercent,
  formatRate,
  formatPercentagePoints,
  formatMultiple,
  formatCount,
  formatChange,
  formatDateRange,
  formatSignedInteger,
  NOT_PROVIDED,
  NOT_COMPARABLE,
} from '@/lib/format';

describe('display formatting', () => {
  it('rounds main metric deltas to whole percentages, half away from zero', () => {
    expect(formatWholePercent(73.925104)).toBe('+74%');
    expect(formatWholePercent(-42.884756)).toBe('-43%');
    expect(formatWholePercent(0)).toBe('0%');
    expect(formatWholePercent(0.5)).toBe('+1%');
    expect(formatWholePercent(-0.5)).toBe('-1%');
    expect(formatWholePercent(-100)).toBe('-100%');
  });

  it('shows rates to one decimal place on cards and three in detail', () => {
    expect(formatRate(0.0209431)).toBe('2.1%');
    expect(formatRate(0.0119617)).toBe('1.2%');
    expect(formatRate(0.0209431, 3)).toBe('2.094%');
    expect(formatRate(0.0119617, 3)).toBe('1.196%');
    expect(formatRate(0)).toBe('0.0%');
  });

  it('shows percentage points to two decimals with a pp unit', () => {
    expect(formatPercentagePoints(-0.898141)).toBe('-0.90 pp');
    expect(formatPercentagePoints(4.3181818)).toBe('+4.32 pp');
    expect(formatPercentagePoints(0)).toBe('0.00 pp');
  });

  it('shows count multiples to one decimal unless exactly integral', () => {
    expect(formatMultiple(3)).toBe('3x');
    expect(formatMultiple(2.75)).toBe('2.8x');
    expect(formatMultiple(1)).toBe('1x');
  });

  it('distinguishes a real zero from missing and from not comparable', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12540)).toBe('12,540');
    expect(formatCount(null)).toBe(NOT_PROVIDED);
    expect(NOT_PROVIDED).toBe('Not provided');
    expect(NOT_COMPARABLE).toBe('Not comparable');
  });

  it('never renders NaN or Infinity', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatWholePercent(bad)).toBe(NOT_COMPARABLE);
      expect(formatRate(bad)).toBe(NOT_PROVIDED);
      expect(formatPercentagePoints(bad)).toBe(NOT_PROVIDED);
      expect(formatMultiple(bad)).toBe(NOT_PROVIDED);
      expect(formatCount(bad)).toBe(NOT_PROVIDED);
    }
  });

  it('formats each change state in words rather than a misleading number', () => {
    expect(formatChange({ kind: 'relative', percent: 73.925104, absolute: 5330 })).toBe('+74%');
    expect(formatChange({ kind: 'new', absolute: 5 })).toBe('New activity');
    expect(formatChange({ kind: 'no_activity', absolute: 0 })).toBe('No activity');
    expect(formatChange({ kind: 'unavailable', reason: 'x' })).toBe(NOT_COMPARABLE);
  });

  it('signs integer changes explicitly', () => {
    expect(formatSignedInteger(31)).toBe('+31');
    expect(formatSignedInteger(-4)).toBe('-4');
    expect(formatSignedInteger(0)).toBe('0');
    expect(formatSignedInteger(null)).toBe(NOT_PROVIDED);
  });

  it('renders an inclusive date range in a stable readable form', () => {
    expect(formatDateRange('2026-07-12', '2026-08-10')).toBe('12 Jul 2026 - 10 Aug 2026');
  });
});
