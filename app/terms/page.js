export const metadata = {
  title: 'Terms & Disclaimer',
  description: 'Terms of use and important disclaimers for Odds on Deck.',
}

const UPDATED = 'June 9, 2026'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{title}</h2>
      <div className="text-sm text-slate-300 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

export default function Terms() {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Terms &amp; Disclaimer</h1>
        <p className="text-xs text-slate-500 mt-1.5 tabular-nums font-mono">Last updated: {UPDATED}</p>
      </div>

      <div className="rounded-[4px] border border-amber-500/20 bg-amber-500/[0.08] p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-amber-400 mb-2">Not Betting or Financial Advice</h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          Odds on Deck provides statistical projections and informational content for entertainment
          purposes only. Nothing on this site is betting, financial, investment, or professional
          advice. Projections are estimates and may be inaccurate. Past performance does not guarantee
          future results. You are solely responsible for any decisions you make.
        </p>
      </div>

      <Section title="Eligibility & Age">
        <p>
          You must be of legal age to view sports betting information and to gamble in your
          jurisdiction (typically 18+ or 21+). By using this site you confirm you meet your local
          legal age and that accessing this content is lawful where you are.
        </p>
      </Section>

      <Section title="Responsible Gambling">
        <p>
          If you choose to gamble, please do so responsibly and only with money you can afford to
          lose. Gambling can be addictive. If you or someone you know has a gambling problem, help is
          available — in the U.S. call or text the National Problem Gambling Helpline at
          <span className="text-slate-100 font-medium"> 1-800-GAMBLER</span> (1-800-426-2537).
        </p>
      </Section>

      <Section title="No Warranty">
        <p>
          The site is provided &ldquo;as is&rdquo; without warranties of any kind, express or implied,
          including accuracy, completeness, availability, or fitness for a particular purpose. Sports
          data is sourced from third parties and may contain errors or delays.
        </p>
      </Section>

      <Section title="Limitation of Liability">
        <p>
          To the maximum extent permitted by law, Odds on Deck and its operators are not liable for
          any losses or damages arising from your use of, or reliance on, the site or its content,
          including any gambling losses.
        </p>
      </Section>

      <Section title="Acceptable Use">
        <p>
          Do not abuse, scrape at scale, overload, or attempt to gain unauthorized access to the site
          or its APIs. We may rate-limit or block traffic to protect the service.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          Your use is also governed by our{' '}
          <a href="/privacy" className="text-blue-400 hover:text-blue-300">Privacy Policy</a>.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms at any time. Continued use after changes constitutes acceptance of
          the updated terms.
        </p>
      </Section>
    </div>
  )
}
