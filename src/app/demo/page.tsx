import Link from 'next/link';
import { analyzeReport } from '@/domain/analyze';
import { renderResponse, DEFAULT_TEMPLATE_BODY } from '@/domain/render-response';
import {
  makeDemoReport,
  DEMO_NOW,
  DEMO_AGENCY_NAME,
  DEMO_CLIENT_NAME,
} from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';
import { buildDashboardViewModel } from '@/features/dashboard/view-model';
import { Dashboard } from '@/features/dashboard/dashboard';
import { BrandMark } from '@/components/navigation';
import { SponsorBanner } from '@/components/sponsor-banner';

/**
 * The public demo.
 *
 * It runs the real analysis engine over fixed fictional fixtures held in
 * memory. There is no session, no database read and no write endpoint, so it
 * cannot touch production data.
 */
export const dynamic = 'force-static';

export const metadata = {
  title: 'Demo - SEO Client Excuse Detector',
  description: 'A read-only demonstration using clearly fictional sample data.',
};

export default function DemoPage() {
  const report = makeDemoReport();
  const complaint = makeDemoComplaint();
  const result = analyzeReport(report, complaint, {
    now: new Date(DEMO_NOW),
    ruleVersion: '1.0.0',
  });
  const { generatedText } = renderResponse({
    template: { id: 'demo', name: 'Default response', body: DEFAULT_TEMPLATE_BODY },
    context: {
      clientName: DEMO_CLIENT_NAME,
      agencyName: DEMO_AGENCY_NAME,
      senderName: 'Demo Analyst',
    },
    report,
    complaint,
    result,
  });

  const view = buildDashboardViewModel({
    report,
    complaint,
    result,
    response: { revision: 1, generatedText, editedText: null },
    clientName: DEMO_CLIENT_NAME,
    reportLabel: report.metadata.reportLabel,
    // Fixed so the demo reads identically on every visit.
    now: new Date(DEMO_NOW),
  });

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto w-full max-w-[1420px] px-4 py-5 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-caution/40 bg-caution/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandMark size={30} />
            <div>
              <p className="text-[14px] font-semibold text-ink">
                Demonstration with fictional data
              </p>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                &ldquo;{DEMO_CLIENT_NAME}&rdquo; is an invented company on the reserved
                example.com domain. Every figure here is sample data. Nothing on this page is
                saved, and no real account is involved.
              </p>
            </div>
          </div>
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-[10px] bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            Sign in
          </Link>
        </div>

        <Dashboard view={view} analysisId="demo" readOnly />
      </div>
      <SponsorBanner />
    </div>
  );
}
