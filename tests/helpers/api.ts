import type { TestUser } from './auth';

/**
 * Calls real route handlers with real Request objects, so tests exercise the
 * actual membership check, same-origin check, validation and envelope rather
 * than a mocked repository.
 */

const ORIGIN = 'http://localhost:3100';

export type ApiResponse<T = unknown> = {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  data: T;
  code: string | null;
};

async function read<T>(response: Response): Promise<ApiResponse<T>> {
  const status = response.status;
  if (status === 204) return { status, body: null, data: null as T, code: null };
  const body = await response.json();
  return { status, body, data: body?.data as T, code: body?.error?.code ?? null };
}

function headersFor(user: TestUser | null, mutating: boolean): Headers {
  const headers = new Headers(user ? user.headers : undefined);
  if (mutating) {
    headers.set('origin', ORIGIN);
    headers.set('content-type', 'application/json');
  }
  return headers;
}

type Handler = (request: Request, context: never) => Promise<Response>;

export async function call<T = unknown>(
  handler: Handler,
  options: {
    method?: string;
    path: string;
    user?: TestUser | null;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    /** Set false to simulate a cross-site request. */
    origin?: string | false;
  },
): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const mutating = method !== 'GET' && method !== 'HEAD';
  const headers = headersFor(options.user ?? null, mutating);

  if (options.origin === false) headers.delete('origin');
  else if (typeof options.origin === 'string') headers.set('origin', options.origin);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);

  const request = new Request(`${ORIGIN}${options.path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const context = { params: Promise.resolve(options.params ?? {}) } as never;
  return read<T>(await handler(request, context));
}
