import Stripe from "stripe"

// Thin wrappers around Stripe's own subscription APIs. VibeCart does not
// keep its own copy of subscription state — Stripe is the source of truth,
// read live on every call. This means no database is required for the
// dashboard or admin views, at the cost of an extra Stripe API round trip
// per page load. Fine for small-to-medium subscriber counts; if you're at a
// scale where that matters, mirror subscriptions into your own DB via
// webhooks (see app/api/webhook/stripe/route.ts) and read from there instead.
//
// NOTE: as of the Stripe API's 2025-03-31 "Basil" release, current_period_end
// and current_period_start were REMOVED from the Subscription object and
// moved to each SubscriptionItem instead (subscriptions can now have items
// on different billing cycles). This code reads them from the item, not the
// subscription — if you see TypeScript errors about a missing
// current_period_end on Subscription elsewhere in your codebase, that's why.

export interface VibeSubscriptionStatus {
  subscriptionId: string
  status: Stripe.Subscription.Status
  planName: string
  priceId: string
  priceCents: number
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface VibeAdminSubscriberRow {
  subscriptionId: string
  customerEmail: string
  status: Stripe.Subscription.Status
  planName: string
  priceCents: number
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

function itemPeriodEnd(item: Stripe.SubscriptionItem | undefined): Date | null {
  const end = (item as unknown as { current_period_end?: number } | undefined)?.current_period_end
  return end ? new Date(end * 1000) : null
}

/**
 * Creates a Stripe Billing Portal session for an already-known, already-
 * verified Stripe customer. The caller is responsible for verifying that
 * `stripeCustomerId` actually belongs to the currently authenticated user
 * BEFORE calling this — see the security note in app/api/billing-portal/route.ts.
 */
export async function createBillingPortalSession(
  stripe: Stripe,
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })
  return session.url
}

/** Read-only: current subscription status for one customer, straight from Stripe. */
export async function getSubscriptionStatus(
  stripe: Stripe,
  stripeCustomerId: string
): Promise<VibeSubscriptionStatus | null> {
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    limit: 1,
    status: "all",
  })
  const sub = subs.data[0]
  if (!sub) return null
  const item = sub.items.data[0]
  return {
    subscriptionId: sub.id,
    status: sub.status,
    planName: item.price.nickname ?? item.price.id,
    priceId: item.price.id,
    priceCents: item.price.unit_amount ?? 0,
    currentPeriodEnd: itemPeriodEnd(item),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
}

/**
 * Admin only: lists recent subscriptions across ALL customers, straight from
 * Stripe. This returns customer emails and billing status — sensitive data.
 * The route calling this MUST be gated behind your own admin-only auth check.
 * VibeCart has no concept of "admin" — that access control is entirely your
 * app's responsibility.
 */
export async function listActiveSubscriptions(
  stripe: Stripe,
  limit = 25
): Promise<VibeAdminSubscriberRow[]> {
  const subs = await stripe.subscriptions.list({
    status: "all",
    limit,
    expand: ["data.customer"],
  })
  return subs.data.map(sub => {
    const customer = sub.customer as Stripe.Customer
    const item = sub.items.data[0]
    return {
      subscriptionId: sub.id,
      customerEmail: customer?.email ?? "unknown",
      status: sub.status,
      planName: item.price.nickname ?? item.price.id,
      priceCents: item.price.unit_amount ?? 0,
      currentPeriodEnd: itemPeriodEnd(item),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }
  })
}
