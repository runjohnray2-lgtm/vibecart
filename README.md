# VibeCart

A one-file Stripe Checkout button for vibe-coded (AI-built) websites — not a
full shopping cart. One component, one API route, no cart-state management,
no platform fee. Payments go straight to your own Stripe account.

## What this is (and isn't)

This is a **single-item Checkout button**, not a multi-product cart. Each
`VibeCartButton` checks out its own item independently — there's no shared
"add several things, then pay once" flow. If you need that, or inventory
management, tax/shipping calculation, or an admin dashboard, use Shopify Buy
Button, Snipcart, or Medusa instead.

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

## Integration — two paths

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

See `/llms.txt` for the full machine-readable integration spec, including
the complete source code and common failure modes.

## Order confirmation (optional)

`/api/webhook/stripe` is a stub webhook receiver — verifies the Stripe
signature and logs `checkout.session.completed` events, but does not send
an email or write to a database yet. Set `STRIPE_WEBHOOK_SECRET` and point a
Stripe webhook at this endpoint if you want to start wiring in real
fulfillment.

## What's NOT built yet (known gaps, not hidden)

- No admin dashboard or inventory management
- No tax calculation or multi-currency support
- No shared multi-item cart — each button is an independent single-item checkout
- Product catalog is a static in-memory array, not a database
- Webhook stub logs events but doesn't fulfill orders (email, DB, shipping)
- Next.js App Router only — not adapted for Pages Router, Remix, SvelteKit, or Astro

## License

MIT-style — free to use and adapt.
