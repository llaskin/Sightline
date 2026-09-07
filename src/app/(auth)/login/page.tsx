import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';
import { BrandMark } from '@/components/navigation';
import { SponsorBanner } from '@/components/sponsor-banner';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in - Sightline' };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark />
          <h1 className="text-[22px] font-semibold leading-tight text-ink">Sightline</h1>
        </div>
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          Accounts are created by an operator. There is no public sign-up and no self-service
          password reset in this release; ask your workspace owner if you need access.
        </p>
        </div>
      </main>
      <SponsorBanner />
    </div>
  );
}
