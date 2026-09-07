import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/server/auth';

/** Node runtime: the auth handler reaches the database over TCP. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = toNextJsHandler(getAuth());

export const GET = handler.GET;
export const POST = handler.POST;
