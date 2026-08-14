import { LegalPage } from "@/components/legal-page"

export default function SupportPage() {
  return (
    <LegalPage title="Support">
      <p>
        For setup help, bug reports, or security concerns, open an issue in the public
        VibeCart GitHub repository: {" "}
        <a className="text-emerald-400 hover:underline" href="https://github.com/runjohnray2-lgtm/vibecart/issues">
          runjohnray2-lgtm/vibecart/issues
        </a>.
      </p>
      <p>
        For a payment, refund, delivery, or order question, contact the merchant whose app sent
        you to Stripe Checkout. VibeCart does not fulfill orders or operate the merchant&apos;s Stripe account.
      </p>
      <section className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
        <h2 className="text-xl font-semibold text-neutral-100">Need VibeCart set up or managed for you?</h2>
        <p>
          Businesses can request managed hosting or a done-for-you integration. We can host and
          maintain VibeCart, or install it in your existing site and connect your Stripe integration.
        </p>
        <a
          className="inline-flex rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-neutral-950 hover:bg-emerald-400"
          href="https://github.com/runjohnray2-lgtm/vibecart/issues/new?title=VibeCart%20Cloud%20managed%20setup"
        >
          Request managed setup
        </a>
      </section>
      <p>Never include card numbers, Stripe secret keys, webhook secrets, or other credentials in an issue.</p>
    </LegalPage>
  )
}
