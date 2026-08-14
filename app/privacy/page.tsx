import { LegalPage } from "@/components/legal-page"

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <p><strong>Last updated:</strong> August 14, 2026</p>
      <p>
        VibeCart is a lightweight integration that sends checkout details to Stripe Checkout.
        A merchant using VibeCart connects their own Stripe account. Stripe processes payment
        and card data under the merchant&apos;s Stripe configuration; VibeCart does not store card data.
      </p>
      <p>
        This reference site may receive ordinary request data such as IP address, user agent,
        product ID, and quantity through its hosting logs. The sample catalog is demonstrative.
        Merchants are responsible for their own privacy notice, data practices, and Stripe setup.
      </p>
      <p>Questions can be directed through the contact options on the support page.</p>
    </LegalPage>
  )
}
