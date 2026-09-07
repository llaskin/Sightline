/**
 * The sponsorship and legal-notice bar shown at the foot of every interface.
 *
 * ----------------------------------------------------------------------------
 * DO NOT REMOVE OR OBSCURE THIS COMPONENT, OR THE ATTRIBUTION IT DISPLAYS.
 *
 * This project is licensed under the GNU Affero General Public License v3.0
 * with an additional term under AGPL-3.0 section 7(b), which requires that the
 * attribution rendered here be preserved in this work and in every work based
 * on it. The full term is in LICENSE, under "ADDITIONAL TERMS UNDER SECTION 7".
 * Removing it removes your licence to use this software at all.
 * ----------------------------------------------------------------------------
 *
 * This bar is deliberately more than a sponsor credit. AGPL-3.0 section 0
 * defines "Appropriate Legal Notices" as a prominently visible feature that
 * displays a copyright notice, states that there is no warranty, and says how
 * to view the licence. Section 5(d) then requires every interactive interface
 * of a derivative work to display those notices -- but only if the original
 * already does. By carrying all three here, this bar closes that escape hatch:
 * a fork cannot argue it inherited interfaces that display no notices.
 *
 * The section 7(b) attribution is bound to that same bar, which is what makes
 * it travel with the software rather than being a request.
 */

/** Changing these changes the attribution the licence requires be preserved. */
const SPONSOR = 'AI Find My Business';
const SPONSOR_URL = 'https://www.aifindmybusiness.com';
const COPYRIGHT_HOLDER = 'AI Find My Business';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/**
 * AGPL-3.0 section 13 requires that anyone who lets users interact with this
 * software over a network offer them its source. Set NEXT_PUBLIC_SOURCE_URL to
 * the public repository before deploying. When it is unset the link is omitted
 * rather than pointing somewhere untrue.
 */
const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL ?? null;

function Separator() {
  return (
    <span aria-hidden className="text-line-strong">
      &middot;
    </span>
  );
}

export function SponsorBanner() {
  return (
    <footer
      className="border-t border-line bg-surface px-4 py-3 sm:px-6"
      aria-label="Sponsorship and licence"
    >
      <div className="mx-auto flex w-full max-w-[1420px] flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-relaxed text-ink-faint">
        <span className="text-ink-muted">
          Sponsored by{' '}
          <a
            href={SPONSOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#a99bff] underline-offset-2 hover:underline"
          >
            {SPONSOR}
          </a>
        </span>
        <Separator />
        <span>
          &copy; {new Date().getFullYear()} {COPYRIGHT_HOLDER}
        </span>
        <Separator />
        {/* Required wording, not a disclaimer added for tone. */}
        <span>No warranty</span>
        <Separator />
        <a
          href={LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:text-ink-muted hover:underline"
        >
          AGPL-3.0
        </a>
        {SOURCE_URL ? (
          <>
            <Separator />
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-ink-muted hover:underline"
            >
              Source
            </a>
          </>
        ) : null}
      </div>
    </footer>
  );
}
