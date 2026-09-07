import { describe, expect, it } from 'vitest';
import { sameOriginPath } from '@/lib/safe-path';

/**
 * Redirect targets that arrive in a query string.
 *
 * The obvious check -- "starts with a slash but not two" -- is wrong, and was
 * shipped here before this test existed. The URL parser treats a backslash as a
 * slash for http(s) and strips tabs and newlines before parsing, so several
 * values that begin with a single forward slash still resolve to another
 * origin. These cases are the reason the implementation parses instead.
 */
describe('sameOriginPath', () => {
  it('keeps an ordinary application path', () => {
    expect(sameOriginPath('/dashboard')).toBe('/dashboard');
    expect(sameOriginPath('/analyses/new?clientId=abc')).toBe('/analyses/new?clientId=abc');
    expect(sameOriginPath('/history#latest')).toBe('/history#latest');
  });

  it('rejects an absolute or protocol-relative URL', () => {
    expect(sameOriginPath('https://example.net/steal')).toBeNull();
    expect(sameOriginPath('//example.net/steal')).toBeNull();
    expect(sameOriginPath('http://example.net')).toBeNull();
  });

  it('rejects the values a first-character check lets through', () => {
    // Each of these begins with exactly one forward slash.
    expect(sameOriginPath('/\\example.net/steal')).toBeNull();
    expect(sameOriginPath('/\t/example.net/steal')).toBeNull();
    expect(sameOriginPath('/\n/example.net/steal')).toBeNull();
    expect(sameOriginPath('/\r/example.net/steal')).toBeNull();
  });

  it('rejects a scheme that is not a path at all', () => {
    expect(sameOriginPath('javascript:alert(1)')).toBeNull();
    expect(sameOriginPath('data:text/html,<script>')).toBeNull();
  });

  it('treats a missing or empty value as no destination', () => {
    expect(sameOriginPath(null)).toBeNull();
    expect(sameOriginPath(undefined)).toBeNull();
    expect(sameOriginPath('')).toBeNull();
  });

  it('does not treat a bare word as a path', () => {
    // Relative to the base this becomes /dashboard, which would be a
    // destination the caller never offered. Only an explicit path is kept.
    expect(sameOriginPath('dashboard')).toBeNull();
  });
});
