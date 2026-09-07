'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A keyboard-accessible evidence drawer. Radix handles focus trapping, the
 * escape key and returning focus to the trigger when it closes, which are the
 * parts most often got wrong by hand.
 */
export function Drawer({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-[520px] flex-col overflow-y-auto border-l border-line bg-surface p-5 shadow-2xl focus:outline-none"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[17px] font-semibold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-line text-ink-muted hover:text-ink"
            >
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
