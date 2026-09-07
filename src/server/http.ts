import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ForbiddenError, UnauthenticatedError, requireMembership, type MembershipContext } from './require-membership';

/**
 * Shared response envelopes and error mapping. Stack traces and internal
 * messages never reach a client; an error code and a safe message do.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'CLIENT_ARCHIVED'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'ORIGIN_REJECTED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CLIENT_ARCHIVED: 409,
  VALIDATION_FAILED: 422,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  ORIGIN_REJECTED: 403,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what = 'That item') =>
  // A resource in another workspace is reported as not found, never as
  // forbidden, so an identifier cannot be probed for existence.
  new ApiError('NOT_FOUND', `${what} was not found, or you do not have access to it`);

export const revisionConflict = (latestRevision: number, extra: Record<string, unknown> = {}) =>
  new ApiError('REVISION_CONFLICT', 'This was changed by someone else since you loaded it', undefined, {
    latestRevision,
    ...extra,
  });

function requestId(): string {
  return crypto.randomUUID();
}

export function ok<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ data, requestId: requestId() }, { status, headers });
}

export function created<T>(data: T): NextResponse {
  return ok(data, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function failure(error: unknown): NextResponse {
  const id = requestId();

  if (error instanceof UnauthenticatedError) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' }, requestId: id },
      { status: 401 },
    );
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: error.message }, requestId: id },
      { status: 403 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: { code: error.code, message: error.message, fields: error.fields, ...error.extra },
        requestId: id,
      },
      { status: STATUS[error.code] },
    );
  }
  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_';
      (fields[path] ??= []).push(issue.message);
    }
    return NextResponse.json(
      {
        error: { code: 'VALIDATION_FAILED', message: 'Some values need correcting', fields },
        requestId: id,
      },
      { status: 422 },
    );
  }

  // Anything unrecognised is logged by code and request ID only. Report bodies,
  // complaint text, source rows and credentials are never logged.
  const message = error instanceof Error ? error.message : 'unknown';
  const transient = /ECONNREFUSED|ETIMEDOUT|Connection terminated|too many clients/i.test(message);
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: id,
      code: transient ? 'SERVICE_UNAVAILABLE' : 'INTERNAL',
      name: error instanceof Error ? error.name : 'Unknown',
    }),
  );
  return NextResponse.json(
    {
      error: {
        code: transient ? 'SERVICE_UNAVAILABLE' : 'INTERNAL',
        message: transient
          ? 'The service is briefly unavailable. Please try again.'
          : 'Something went wrong. Nothing was saved.',
      },
      requestId: id,
    },
    { status: transient ? 503 : 500 },
  );
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Same-origin enforcement for state-changing requests. Session cookies are
 * SameSite=Lax, and this is the second layer: a mutation must carry an Origin
 * that matches the configured application origin.
 */
export function assertSameOrigin(request: Request): void {
  if (!MUTATING.has(request.method)) return;
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new ApiError('INTERNAL', 'APP_ORIGIN is not configured');

  const origin = request.headers.get('origin');
  if (origin === null) {
    // A browser always sends Origin on a cross-origin mutation. A missing one
    // is a same-origin form post or a non-browser client; require the
    // fetch-metadata header instead of accepting it blindly.
    const site = request.headers.get('sec-fetch-site');
    if (site === null || site === 'same-origin' || site === 'none') return;
    throw new ApiError('ORIGIN_REJECTED', 'This request did not come from the application');
  }
  if (origin !== expected) {
    throw new ApiError('ORIGIN_REJECTED', 'This request did not come from the application');
  }
}

/** Wraps a route handler: same-origin check, membership, envelope, error mapping. */
export function route<T>(
  handler: (context: MembershipContext, request: Request) => Promise<NextResponse>,
): (request: Request, routeContext: T) => Promise<NextResponse> {
  return async (request: Request) => {
    try {
      assertSameOrigin(request);
      const context = await requireMembership(request.headers);
      return await handler(context, request);
    } catch (error) {
      return failure(error);
    }
  };
}

export const MAX_JSON_BYTES = 1024 * 1024;

/** Reads a JSON body under an explicit byte cap. */
export async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_JSON_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'That request body is too large');
  }
  const text = await request.text();
  // A chunked request may omit Content-Length, so the real size is checked too.
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'That request body is too large');
  }
  try {
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'The request body is not valid JSON');
  }
}

/** Keyset pagination parameters, bounded so a caller cannot request everything. */
export function readPagination(url: URL): { limit: number; cursor: string | null } {
  const raw = Number(url.searchParams.get('limit') ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;
  return { limit, cursor: url.searchParams.get('cursor') };
}

/** Private pages and exports must never be stored by a shared cache. */
export const PRIVATE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
} as const;
