export const metadata = {
  title: 'Privacy Policy',
  description: 'How Odds on Deck collects, uses, and protects information.',
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

export default function PrivacyPolicy() {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Privacy Policy</h1>
        <p className="text-xs text-slate-500 mt-1.5 tabular-nums font-mono">Last updated: {UPDATED}</p>
      </div>

      <Section title="Overview">
        <p>
          Odds on Deck (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is an informational sports analytics tool.
          We do not require an account, and we do not ask for your name, email, payment details, or
          other personally identifying information to use the site.
        </p>
      </Section>

      <Section title="Information We Collect">
        <p>
          <span className="text-slate-100 font-medium">Analytics data.</span> We use Google Analytics
          and Vercel Analytics to understand aggregate usage (pages viewed, approximate location,
          device/browser type, referring site). These services may set cookies and process your IP
          address. This data is used in aggregate and is not used to identify you.
        </p>
        <p>
          <span className="text-slate-100 font-medium">Local storage.</span> When you save a prop or
          pick, that selection is stored in your browser&apos;s local storage on your own device. It
          is not linked to your identity and is not transmitted to us as personal data.
        </p>
        <p>
          <span className="text-slate-100 font-medium">Saved picks &amp; parlays.</span> Picks and
          parlays you choose to save are stored anonymously in our database for accuracy tracking.
          They are not associated with any personal identifier.
        </p>
      </Section>

      <Section title="How We Use Information">
        <p>
          To operate, maintain, and improve the site; to measure performance and accuracy of our
          models; and to diagnose technical issues. We do not sell your personal information.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Cookies are used by our analytics providers. You can control or disable cookies through your
          browser settings. Disabling cookies will not break core functionality of the site.
        </p>
      </Section>

      <Section title="Third-Party Services">
        <p>
          We rely on third parties including Google Analytics, Vercel (hosting/analytics), Supabase
          (database), and sports data providers (e.g., ESPN, The Odds API). Their handling of data is
          governed by their own privacy policies.
        </p>
      </Section>

      <Section title="Your Choices">
        <p>
          You may browse without saving any picks, clear your browser local storage at any time, and
          opt out of Google Analytics using Google&apos;s browser opt-out add-on. Depending on your
          location, you may have rights under the GDPR or CCPA; contact us to exercise them.
        </p>
      </Section>

      <Section title="Children">
        <p>
          This site is intended for adults of legal age in their jurisdiction and is not directed to
          children. See our <a href="/terms" className="text-blue-400 hover:text-blue-300">Terms &amp; Disclaimer</a>.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update this policy from time to time. Material changes will be reflected by the
          &ldquo;Last updated&rdquo; date above.
        </p>
      </Section>
    </div>
  )
}
