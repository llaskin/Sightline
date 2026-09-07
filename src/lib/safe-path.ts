/**
 * Redirect targets that arrive from a query string.
 *
 * Checking the first characters is not enough, and both callers here were wrong
 * for exactly that reason before this module existed: the URL parser treats a
 * backslash as a slash for http(s) and strips tabs, newlines and carriage
 * returns before parsing, so `/\example.net/steal` begins with a single forward
 * slash and still resolves to another origin.
 *
 * Parsing against a base that no request can reach, then comparing origins,
 * makes every one of those normalisations fall out on its own: if the parser
 * moved the value off the sentinel origin, it would have moved a real one off
 * ours too.
 */

/** A sentinel base no request can reach, so only a relative path keeps it. */
const BASE = 'http://return-to.invalid';

/**
 * Returns the path, query and fragment when `candidate` is a same-origin
 * application path, and null for anything else. A value that is not an explicit
 * path -- a bare word, another scheme, a different host -- is rejected rather
 * than repaired, because a caller that supplied a destination we cannot honour
 * should get the default, not a guess.
 */
export function sameOriginPath(candidate: string | null | undefined): string | null {
  if (!candidate || !candidate.startsWith('/')) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate, BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== BASE) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
