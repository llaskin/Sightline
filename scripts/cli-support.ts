import './load-env';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Shared argument and password handling for the operator CLI scripts. */

export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export function required(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) {
    console.error(`Missing required argument --${name}`);
    process.exit(2);
  }
  return value;
}

/**
 * Reads a password from NEW_PASSWORD or an interactive prompt. Deliberately not
 * a command-line argument, so it never enters shell history or a process list.
 */
export async function readPassword(): Promise<string> {
  const fromEnv = process.env.NEW_PASSWORD;
  if (fromEnv) return fromEnv;

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    const value = await rl.question('New password (minimum 12 characters): ');
    if (value.length < 12) {
      console.error('The password must be at least 12 characters.');
      process.exit(2);
    }
    return value;
  } finally {
    rl.close();
  }
}

/** Production seeding of demo content is refused outright. */
export function refuseInProduction(what: string): void {
  if (process.env.NODE_ENV === 'production') {
    console.error(`${what} is not permitted when NODE_ENV=production.`);
    process.exit(2);
  }
}
