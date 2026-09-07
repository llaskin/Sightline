import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sightline',
  description: 'SEO performance and lead-generation evidence for agency client conversations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
