'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TextField } from '@/components/ui/fields';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/primitives';
import { sameOriginPath } from '@/lib/safe-path';

/**
 * Sign-in.
 *
 * The failure message is deliberately identical for a wrong password and an
 * unknown address, so this form cannot be used to discover which email
 * addresses have accounts.
 */
const GENERIC_FAILURE = 'That email address and password combination was not recognised.';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const expired = searchParams.get('expired') === '1';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(GENERIC_FAILURE);
        setPending(false);
        return;
      }
      // Only a same-origin application path is ever followed after sign-in.
      router.push(sameOriginPath(searchParams.get('next')) ?? '/dashboard');
      router.refresh();
    } catch {
      setError('Sign-in could not be completed. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {expired ? (
        <ErrorState
          title="Your session expired"
          description="Sign in again to continue where you left off."
        />
      ) : null}
      {error ? <ErrorState title="Could not sign in" description={error} /> : null}

      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Signing in...' : 'Sign in'}
      </Button>
    </form>
  );
}
