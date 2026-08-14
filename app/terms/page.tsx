import { LegalPage } from "@/components/legal-page"

export default function TermsPage() {
  return (
    <LegalPage title="Terms">
      <p><strong>Last updated:</strong> August 14, 2026</p>
      <p>
        VibeCart is provided as a lightweight Stripe Checkout integration and reference
        implementation. It is not a merchant of record, storefront, inventory system, order
        fulfillment service, or replacement for Shopify or Snipcart.
      </p>
      <p>
        Merchants use and remain responsible for their own Stripe account, catalog, trusted
        server-side prices, taxes, refunds, customer support, legal compliance, and webhook-based
        fulfillment. VibeCart currently charges no platform fee; Stripe fees may still apply.
      </p>
      <p>The software is provided without a guarantee of availability or fitness for a particular purpose.</p>
    </LegalPage>
  )
}
