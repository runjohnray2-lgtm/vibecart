# VibeCart

A lightweight Stripe Checkout primitive for AI-built and vibe-coded apps — not a
full shopping cart. One component, one API route, no cart-state management,
no platform fee. Payments go straight to your own Stripe account. Also
includes optional subscription-management pieces (customer billing portal +
admin subscriber view) for SaaS sites — see below.

## What this is (and isn't)

This is a **single-item Checkout button**, not a multi-product cart. Each
`VibeCartButton` checks out its own item independently — there's no shared
"add several things, then pay once" flow. If you need that, or inventory
management, tax/shipping calculation, or a full admin storefront, use Shopify
Buy Button, Snipcart, or Medusa instead.

## Why this exists

Existing tools in this space were built for human developers reading docs.
VibeCart is designed for AI coding agents scaffolding a checkout flow from a
one-line prompt — minimal surface area, one obvious integration path.

## Quick start

1. `npm install` then `npm run dev`
2. Visit `/` — three demo products render in **demo mode** (no real charges)
   until you set a Stripe key.
3. Add `STRIPE_SECRET_KEY` (your own Stripe secret key, test or live) as an
   environment variable to go live. Never commit it or paste it in chat —
   add it directly in your hosting provider's dashboard.

## One-time checkout — two paths

**Path A (recommended, secure):** register the product in `lib/products.ts`
first, then reference it by ID. The server looks up the trusted price —
nobody can tamper with it from the browser.

```tsx
import { VibeCartButton } from "@/components/vibe-cart-button"

<VibeCartButton
  product={{
    id: "my-product",
    name: "My Product",
    description: "...",
    priceCents: 1999,
    image: "https://example.com/my-product.png",
  }}
/>
```

**Path B (prototypes only, NOT secure):** skip the catalog with
`trustClientPrice` — the price is sent from the browser and could be edited
before it arrives at the server.

```tsx
<VibeCartButton product={{ id: "temp", name: "Temp", priceCents: 500, image: "https://..." }} trustClientPrice />
```

Optional: `showQuantityStepper` adds a +/- control before the buy button.
Optional: `product.variant` (e.g. `"Size: L"`) displays above the button.

## Subscriptions — customer dashboard + admin view (new)

For SaaS sites selling recurring plans, Stripe's Checkout in `subscription`
mode and its hosted Billing Portal handle the actual billing (trials,
proration, invoices, plan changes, cancellation) — VibeCart doesn't rebuild
any of that. What it adds is the drop-in wiring:

- **`<VibeManageSubscriptionButton />`** — customer-facing button that opens
  Stripe's own hosted Billing Portal (change plan, update card, view
  invoices, cancel — all Stripe's UI, not custom-built here).
- **`<VibeAdminSubscribersTable />`** — read-only admin table of all
  subscribers, read live from Stripe on every load. No database required to
  track subscription state.
- **`lib/vibe-billing.ts`** — the underlying Stripe-wrapping functions
  (`createBillingPortalSession`, `getSubscriptionStatus`,
  `listActiveSubscriptions`) if you want to build custom UI instead of using
  the components directly.

⚠️ **VibeCart has no auth system of its own.** `app/api/billing-portal/route.ts`
and `app/api/admin/subscribers/route.ts` are EXAMPLE routes with a stub
function that intentionally fails closed (`getCurrentUserStripeCustomerId()`
returns `null`, `isCurrentUserAdmin()` returns `false`) until you replace it
with your own session/auth lookup. Read the comments in those two files
before deploying — this is the single most important thing to get right,
since getting it wrong means one user could view or manage another user's
billing. See `/dashboard` and `/admin` for live demos of the fail-closed
behavior.

**Real-world note:** as of Stripe's 2025-03-31 API update, subscription
`current_period_end`/`current_period_start` moved from the subscription
object to each subscription item — `lib/vibe-billing.ts` already reads them
from the item. If other code in your project reads them from the
subscription directly, it needs the same fix.

See `/llms.txt` for the full machine-readable integration spec, including
the complete source code and common failure modes.

Agent clients can also discover the four production MCP tools at `/mcp`.
`GET /api/health` reports service readiness and Stripe/webhook configuration
as booleans without exposing credentials. Public policies and help are at
`/privacy`, `/terms`, and `/support`; submission test prompts are documented
in `docs/submission-evaluation.md`.

## Order confirmation (optional)

`/api/webhook/stripe` is a stub webhook receiver — verifies the Stripe
signature and logs `checkout.session.completed` events, but does not send
an email or write to a database yet. Set `STRIPE_WEBHOOK_SECRET` and point a
Stripe webhook at this endpoint if you want to start wiring in real
fulfillment.

## What's NOT built yet (known gaps, not hidden)

- No inventory management or tax calculation
- No shared multi-item cart — each button is an independent single-item checkout
- Product catalog is a static in-memory array, not a database
- Webhook stub logs events but doesn't fulfill orders (email, DB, shipping)
- No auth system — dashboard/admin routes require you to wire in your own
- Admin subscriber list reads live from Stripe on every load — fine at small
  scale, but no pagination/caching built in yet for large subscriber counts
- Next.js App Router only — not adapted for Pages Router, Remix, SvelteKit, or Astro

## License

MIT-style — free to use and adapt.
