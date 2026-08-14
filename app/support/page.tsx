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
      <p>Never include card numbers, Stripe secret keys, webhook secrets, or other credentials in an issue.</p>
    </LegalPage>
  )
}
